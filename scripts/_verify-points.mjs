// Rolled-back verification for 20260811000020 (ledger, balance, rates),
// 20260811000030 (a settled bill earns its points) and 20260811000040
// (points can settle a bill).
//
// Storage and earning: the ledger is append-only truth, customers.points_balance
// is a trigger-derived cache of it (never written directly), earning follows
// total_incl at one flat shop-wide rate, fires once on FULL settlement (not
// per part-payment — flooring fragments would lose points to rounding), nets
// out whatever the same invoice already collected in points (so a balance
// cannot top itself up), and is idempotent under a retried or replayed award
// via the ledger's unique partial index.
//
// Spending: a points payment is a TENDER — total_incl and the VAT snapshot
// never move, only how the bill gets settled — and gets its own branch ahead
// of record_payment's external-reference else-branch, because the ledger row
// it writes IS the reference. The rupee cost rounds UP (ceil), never down, so
// the shop is never out of pocket for a fraction of a point. Still gated on
// an open till like every other method (20260716000040): a points payment is
// real settlement the cash-up has to see.
//
// Runs as `authenticated` impersonating first the shop owner (Anesh), then —
// for anything that must ISSUE a document — the sandbox tenant's owner: the
// real shop's trading day is CLOSED today, and issue_document refuses
// everything while it is. The sandbox (20260804000060) has no trading day
// today, so app.assert_day_open passes there. Always ROLLS BACK.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner auth uid, real tenant)
const SANDBOX_AUTH = "b729191b-1159-4d46-88c7-3c9aceb5e664"; // TEST Sandbox (owner) — no trading day today

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};
// Collapses an expected refusal message to a short token but leaves any OTHER
// message intact, so a failure for the wrong reason shows up instead of
// hiding behind a look-alike pass.
const asRefusal = (out, want, token) => (out.includes(want) ? token : out);

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
const asUser = async (authUid) => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: authUid, role: "authenticated" }),
  ]);
};
const mkLine = (over) => ({
  product_id: null, title: "Points probe line", description: null, qty: 1, unit_price: 1000,
  discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15,
  sort_order: 0, line_kind: "product", ...over,
});

try {
  await c.query("begin");
  await asUser(AUTH);
  const tenant = (await c.query("select app.current_tenant_id() as t")).rows[0].t;

  console.log("▸ 1. a new customer starts at 0");
  const cust = (await c.query(
    "insert into public.customers (tenant_id, name) values ($1,'Points Probe Customer') returning id, points_balance",
    [tenant],
  )).rows[0];
  check("points_balance on a fresh customer", cust.points_balance, 0);

  console.log("▸ 2. a ledger row moves the balance, both directions");
  // customer_points_ledger has no INSERT policy for `authenticated` — every real
  // write goes through a SECURITY DEFINER RPC. Seed directly as table owner to
  // probe the balance-trigger itself, in isolation from any RPC's own logic.
  await c.query("set local role postgres");
  const owner = (await c.query(
    "select id from public.app_users where tenant_id=$1 and role='owner' and is_active limit 1", [tenant],
  )).rows[0].id;
  await c.query(
    `insert into public.customer_points_ledger (tenant_id, customer_id, delta, reason, ref_type, ref_id, created_by)
     values ($1,$2,20,'adjusted',null,null,$3)`,
    [tenant, cust.id, owner],
  );
  let bal = (await c.query("select points_balance from public.customers where id=$1", [cust.id])).rows[0].points_balance;
  check("a +20 row credits the balance", bal, 20);
  await c.query(
    `insert into public.customer_points_ledger (tenant_id, customer_id, delta, reason, ref_type, ref_id, created_by)
     values ($1,$2,-8,'adjusted',null,null,$3)`,
    [tenant, cust.id, owner],
  );
  bal = (await c.query("select points_balance from public.customers where id=$1", [cust.id])).rows[0].points_balance;
  check("a -8 row debits it back down", bal, 12);

  console.log("▸ 3. the ledger refuses an UPDATE (append-only)");
  const row = (await c.query(
    "select id from public.customer_points_ledger where customer_id=$1 order by created_at limit 1", [cust.id],
  )).rows[0];
  let updateOutcome = "not refused — no exception was raised";
  await c.query("savepoint su");
  try {
    const r = await c.query("update public.customer_points_ledger set delta = 999 where id=$1", [row.id]);
    updateOutcome = `not refused — ${r.rowCount} row(s) updated`;
  } catch (e) { updateOutcome = e.message; }
  await c.query("rollback to savepoint su");
  check("an UPDATE is refused", asRefusal(updateOutcome, "append-only", "refused: append-only"), "refused: append-only");

  // Bonus: forbid_mutation guards DELETE too — same trigger, same table.
  let deleteOutcome = "not refused — no exception was raised";
  await c.query("savepoint sd");
  try {
    const r = await c.query("delete from public.customer_points_ledger where id=$1", [row.id]);
    deleteOutcome = `not refused — ${r.rowCount} row(s) deleted`;
  } catch (e) { deleteOutcome = e.message; }
  await c.query("rollback to savepoint sd");
  check("a DELETE is refused too", asRefusal(deleteOutcome, "append-only", "refused: append-only"), "refused: append-only");

  await asUser(AUTH); // hand control back to `authenticated`, as though the seeding above never happened

  console.log("▸ 4. the rates default the way the owner specified");
  const bs = (await c.query(
    "select points_per_100, point_value_rupees from public.business_settings where id=$1", [tenant],
  )).rows[0];
  check("points_per_100 defaults to 1", Number(bs.points_per_100), 1);
  check("point_value_rupees defaults to 1.00", Number(bs.point_value_rupees), 1.00);

  // ── earning: everything that ISSUES runs in the SANDBOX tenant ──────────────
  await asUser(SANDBOX_AUTH);
  const sbTenant = (await c.query("select app.current_tenant_id() as t")).rows[0].t;
  check("the sandbox is a different tenant from the shop", sbTenant !== tenant, true);

  const sbCustomer = (await c.query(
    "insert into public.customers (tenant_id, name) values ($1,'Points Probe (sandbox)') returning id",
    [sbTenant],
  )).rows[0].id;

  // record_payment only cares that the session's STATUS is 'open' — it never
  // checks the trading day is TODAY's (that guard lives in issue_document /
  // open_cash_session, not here). Reuse an open one if there is any.
  let till = (await c.query(
    "select id, status from public.cash_sessions where tenant_id=$1 and status='open' limit 1", [sbTenant],
  )).rows[0];
  if (!till) {
    till = (await c.query("select id, status from public.open_cash_session('SANDBOX-POINTS-VERIFY', 0)")).rows[0];
  }
  check("a till is open for the sandbox", till.status, "open");

  console.log("▸ 5. a Rs 1,150 invoice settled in full earns 11 points");
  const draft = (await c.query(
    "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: sbCustomer }), JSON.stringify([mkLine({})])],
  )).rows[0];
  const inv = (await c.query("select * from public.issue_document($1::uuid, null, null, null)", [draft.id])).rows[0];
  check("invoice total_incl", inv.total_incl, "1150.00");
  const before = (await c.query("select points_balance from public.customers where id=$1", [sbCustomer])).rows[0].points_balance;
  check("sandbox customer starts at 0 too", before, 0);

  await c.query(
    "select method, amount from public.record_payment($1::uuid, 'cash'::payment_method, 1150, 1150, null, $2::uuid, null, null)",
    [inv.id, till.id],
  );
  const afterPay = (await c.query("select points_balance from public.customers where id=$1", [sbCustomer])).rows[0].points_balance;
  check("11 points landed on the customer", afterPay, 11);
  const invStatus = (await c.query("select status from public.documents where id=$1", [inv.id])).rows[0].status;
  check("the invoice is fully paid", invStatus, "paid");

  console.log("▸ 6. exactly one 'earned' row exists, and paying again does not add another");
  const earnedRows = (await c.query(
    "select count(*)::int n from public.customer_points_ledger where ref_type='document' and ref_id=$1 and reason='earned'",
    [inv.id],
  )).rows[0].n;
  check("one earn row after the first full settlement", earnedRows, 1);

  // record_payment itself refuses a genuine second payment (a 'paid' invoice is
  // no longer open for payment at all) — real evidence that "pay again" cannot
  // reach the points logic through the RPC.
  let secondPayOutcome = "accepted";
  await c.query("savepoint sp2");
  try {
    await c.query(
      "select method, amount from public.record_payment($1::uuid, 'cash'::payment_method, 1, 1, null, $2::uuid, null, null)",
      [inv.id, till.id],
    );
  } catch (e) { secondPayOutcome = e.message; }
  await c.query("rollback to savepoint sp2");
  check(
    "record_payment refuses a payment on an already-settled bill",
    asRefusal(secondPayOutcome, "not open for payment", "refused: not open for payment"),
    "refused: not open for payment",
  );

  // The award function itself must be idempotent too — an offline sale replaying
  // its closing payment, or any other retry, calls it again for the SAME
  // invoice. Prove that directly: it is `app`-schema (no client grant), so call
  // it as table owner, exactly as record_payment does internally.
  await c.query("set local role postgres");
  await c.query("select app.award_points_for_invoice($1::uuid)", [inv.id]);
  await asUser(SANDBOX_AUTH);
  const earnedAfterRetry = (await c.query(
    "select count(*)::int n from public.customer_points_ledger where ref_type='document' and ref_id=$1 and reason='earned'",
    [inv.id],
  )).rows[0].n;
  check("still exactly one earn row after a retried award", earnedAfterRetry, 1);
  const balAfterRetry = (await c.query("select points_balance from public.customers where id=$1", [sbCustomer])).rows[0].points_balance;
  check("balance did not move on the retried award", balAfterRetry, 11);

  console.log("▸ bonus: a bill paid in instalments earns once, for its total");
  const draft2 = (await c.query(
    "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: sbCustomer }), JSON.stringify([mkLine({})])],
  )).rows[0];
  const inv2 = (await c.query("select * from public.issue_document($1::uuid, null, null, null)", [draft2.id])).rows[0];
  await c.query(
    "select method, amount from public.record_payment($1::uuid, 'cash'::payment_method, 500, 500, null, $2::uuid, null, null)",
    [inv2.id, till.id],
  );
  const statusMid = (await c.query("select status from public.documents where id=$1", [inv2.id])).rows[0].status;
  check("first instalment leaves it partly paid", statusMid, "partly_paid");
  const earnedMid = (await c.query(
    "select count(*)::int n from public.customer_points_ledger where ref_type='document' and ref_id=$1 and reason='earned'",
    [inv2.id],
  )).rows[0].n;
  check("no points yet on a part payment", earnedMid, 0);

  await c.query(
    "select method, amount from public.record_payment($1::uuid, 'cash'::payment_method, 650, 650, null, $2::uuid, null, null)",
    [inv2.id, till.id],
  );
  const earnedFinal = (await c.query(
    "select count(*)::int n from public.customer_points_ledger where ref_type='document' and ref_id=$1 and reason='earned'",
    [inv2.id],
  )).rows[0].n;
  check("exactly one earn row once the balance clears", earnedFinal, 1);
  const balAfterInstalments = (await c.query("select points_balance from public.customers where id=$1", [sbCustomer])).rows[0].points_balance;
  check("the customer's total balance across both invoices", balAfterInstalments, 22);

  console.log("▸ 7. an invoice with no customer earns nothing");
  // documents has `check (doc_type <> 'invoice' or status = 'draft' or customer_id
  // is not null)` — an ISSUED invoice can never have a null customer, so this
  // edge case is tested directly against the award function, on a draft (where a
  // null customer is legal), exactly as record_payment would call it internally.
  const draftNoCust = (await c.query(
    "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: null }), JSON.stringify([mkLine({ title: "Walk-in, no account" })])],
  )).rows[0];
  check("the draft really has no customer", draftNoCust.customer_id, null);
  check("it has money on it to (not) earn from", Number(draftNoCust.total_incl) > 0, true);

  await c.query("set local role postgres");
  await c.query("select app.award_points_for_invoice($1::uuid)", [draftNoCust.id]);
  await asUser(SANDBOX_AUTH);
  const noCustEarn = (await c.query(
    "select count(*)::int n from public.customer_points_ledger where ref_type='document' and ref_id=$1",
    [draftNoCust.id],
  )).rows[0].n;
  check("no ledger row for a document with no customer", noCustEarn, 0);

  // ─────────────────────────────────────────────────────────────────────────
  // 20260811000040 — points can settle a bill (spending)
  // 20260811000050 — reversing gives the points back (unwinding)
  // Still impersonating SANDBOX_AUTH, on the same open sandbox till as above.
  // ─────────────────────────────────────────────────────────────────────────
  const sbOwner = (await c.query(
    "select id from public.app_users where tenant_id=$1 and role='owner' and is_active limit 1", [sbTenant],
  )).rows[0].id;

  // Seeds a points balance directly on the ledger — same reason as check 2's
  // seeding above: customer_points_ledger has no INSERT policy for
  // `authenticated`, every real write goes through a SECURITY DEFINER RPC.
  const seedPoints = async (customerId, delta) => {
    await c.query("set local role postgres");
    await c.query(
      `insert into public.customer_points_ledger (tenant_id, customer_id, delta, reason, ref_type, ref_id, created_by)
       values ($1,$2,$3,'adjusted',null,null,$4)`,
      [sbTenant, customerId, delta, sbOwner],
    );
    await asUser(SANDBOX_AUTH);
  };
  const balanceOf = async (customerId) =>
    (await c.query("select points_balance from public.customers where id=$1", [customerId])).rows[0].points_balance;

  console.log("▸ 8. spending: Rs 50 of points costs 50 points at the default rate");
  const spendRates = (await c.query(
    "select point_value_rupees from public.business_settings where id=$1", [sbTenant],
  )).rows[0];
  check("sandbox point_value_rupees is still the default 1.00", Number(spendRates.point_value_rupees), 1.00);

  const spendCust = (await c.query(
    "insert into public.customers (tenant_id, name) values ($1,'Points Spend Probe') returning id",
    [sbTenant],
  )).rows[0].id;
  await seedPoints(spendCust, 50);
  check("seeded balance before spending", await balanceOf(spendCust), 50);

  const spendDraft = (await c.query(
    "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: spendCust }), JSON.stringify([mkLine({})])],
  )).rows[0];
  const spendInv = (await c.query("select * from public.issue_document($1::uuid, null, null, null)", [spendDraft.id])).rows[0];
  check("spend invoice total_incl before any payment", spendInv.total_incl, "1150.00");

  const spendPay = (await c.query(
    "select * from public.record_payment($1::uuid, 'points'::payment_method, 50, null, null, $2::uuid, null, null)",
    [spendInv.id, till.id],
  )).rows[0];
  check("50 rupees of points costs exactly 50 points off the balance", await balanceOf(spendCust), 0);
  const spendLedgerRow = (await c.query(
    "select delta from public.customer_points_ledger where ref_type='document' and ref_id=$1 and reason='redeemed'",
    [spendInv.id],
  )).rows[0];
  check("the redeemed ledger row is -50", spendLedgerRow.delta, -50);

  console.log("▸ 9. spending is a tender: total_incl does not move, amount_paid counts it");
  const spendDocAfter = (await c.query(
    "select total_incl, amount_paid, status from public.documents where id=$1", [spendInv.id],
  )).rows[0];
  check("total_incl is unchanged by a points payment", spendDocAfter.total_incl, "1150.00");
  check("amount_paid counts the points payment", Number(spendDocAfter.amount_paid), 50);
  check("the bill is partly paid (settled by a tender), not discounted down", spendDocAfter.status, "partly_paid");

  console.log('▸ 10. an overdraft is refused with "not enough points"');
  let overdraftOutcome = "accepted";
  await c.query("savepoint sod");
  try {
    await c.query(
      "select * from public.record_payment($1::uuid, 'points'::payment_method, 10, null, null, $2::uuid, null, null)",
      [spendInv.id, till.id],
    );
  } catch (e) { overdraftOutcome = e.message; }
  await c.query("rollback to savepoint sod");
  console.log(`    actual message: ${overdraftOutcome}`);
  check(
    "a points payment beyond the balance is refused",
    asRefusal(overdraftOutcome, "not enough points", "refused: not enough points"),
    "refused: not enough points",
  );

  console.log("▸ 11. a points payment on a bill with no customer is refused");
  // Same structural reason as check 7's earning equivalent above: documents'
  // check constraint means an ISSUED invoice can never have a null
  // customer_id, so this is proven directly against app.spend_points on a
  // DRAFT (where a null customer is legal) — exactly as record_payment's new
  // points-branch calls it internally.
  const spendNoCustDraft = (await c.query(
    "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: null }), JSON.stringify([mkLine({ title: "Walk-in, no account, points" })])],
  )).rows[0];
  check("the draft really has no customer", spendNoCustDraft.customer_id, null);
  let noCustSpendOutcome = "accepted";
  await c.query("set local role postgres");
  await c.query("savepoint snocust");
  try {
    await c.query("select app.spend_points($1::uuid, 10)", [spendNoCustDraft.id]);
  } catch (e) { noCustSpendOutcome = e.message; }
  await c.query("rollback to savepoint snocust");
  await asUser(SANDBOX_AUTH);
  console.log(`    actual message: ${noCustSpendOutcome}`);
  check(
    "a points payment with no customer on the bill is refused",
    asRefusal(noCustSpendOutcome, "needs a customer on the bill", "refused: needs a customer on the bill"),
    "refused: needs a customer on the bill",
  );

  console.log("▸ 12. ceil rounding: at point_value_rupees = 1, Rs 50.50 costs 51 points");
  const roundCust = (await c.query(
    "insert into public.customers (tenant_id, name) values ($1,'Points Rounding Probe') returning id",
    [sbTenant],
  )).rows[0].id;
  await seedPoints(roundCust, 60);
  const roundDraft = (await c.query(
    "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: roundCust }), JSON.stringify([mkLine({})])],
  )).rows[0];
  const roundInv = (await c.query("select * from public.issue_document($1::uuid, null, null, null)", [roundDraft.id])).rows[0];
  await c.query(
    "select * from public.record_payment($1::uuid, 'points'::payment_method, 50.50, null, null, $2::uuid, null, null)",
    [roundInv.id, till.id],
  );
  check("Rs 50.50 rounds UP to 51 points, not floored to 50", await balanceOf(roundCust), 9); // 60 seeded - 51 spent
  const roundLedgerRow = (await c.query(
    "select delta from public.customer_points_ledger where ref_type='document' and ref_id=$1 and reason='redeemed'",
    [roundInv.id],
  )).rows[0];
  check("the redeemed ledger row is exactly -51", roundLedgerRow.delta, -51);

  console.log("▸ 13. the drawer is unaffected: expected_cash sums only method='cash'");
  const drawerBefore = (await c.query(
    `select cs.opening_float,
            (select coalesce(sum(amount),0) from public.payments where booked_session_id=cs.id and method='cash') as cash_sum,
            (select coalesce(sum(amount),0) from public.payments where booked_session_id=cs.id and method='points') as points_sum,
            (select coalesce(sum(amount),0) from public.till_movements where cash_session_id=cs.id) as moves_sum
       from public.cash_sessions cs where cs.id=$1`,
    [till.id],
  )).rows[0];
  const pointsOnTill = Number(drawerBefore.points_sum);
  check("there is real points money booked to this till (else the check below proves nothing)", pointsOnTill > 0, true);
  const wantExpected = Number(drawerBefore.opening_float) + Number(drawerBefore.cash_sum) + Number(drawerBefore.moves_sum);
  await c.query("savepoint sclose");
  const closed = (await c.query("select expected_cash from public.close_cash_session($1::uuid, 0)", [till.id])).rows[0];
  check(`expected_cash counts cash only — Rs ${pointsOnTill} of points sat on this same till`, Number(closed.expected_cash), wantExpected);
  await c.query("rollback to savepoint sclose");
  const tillStillOpen = (await c.query("select status from public.cash_sessions where id=$1", [till.id])).rows[0].status;
  check("the till is still open after rolling the close back", tillStillOpen, "open");

  await c.query("rollback");
  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`} (rolled back — nothing persisted)`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (err) {
  try { await c.query("rollback"); } catch {}
  console.error("✗ verify error:", err.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
