// Rolled-back verification that settling several invoices in one action behaves the
// way account-settlement.ts's planSettlement (and settleAccountAction, which calls
// the SAME record_payment RPC per leg) expects: points split across an invoice
// boundary, the remainder taken by a chosen method, each invoice landing on 'paid',
// and the points ledger moving by exactly what was spent. No new SQL exists for this
// feature — this exercises record_payment exactly as the server action calls it,
// back-to-back for two invoices on one till session. Always ROLLS BACK.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const SANDBOX_AUTH = "b729191b-1159-4d46-88c7-3c9aceb5e664"; // TEST Sandbox (owner) — no trading day today

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
const asUser = async (authUid) => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: authUid, role: "authenticated" }),
  ]);
};
const mkLine = (unitPrice) => ({
  product_id: null, title: "Settle probe line", description: null, qty: 1, unit_price: unitPrice,
  discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 0,
  sort_order: 0, line_kind: "product",
});

try {
  await c.query("begin");
  await asUser(SANDBOX_AUTH);
  const tenant = (await c.query("select app.current_tenant_id() as t")).rows[0].t;

  const owner = (await c.query(
    "select id from public.app_users where tenant_id=$1 and role='owner' and is_active limit 1", [tenant],
  )).rows[0].id;
  const cust = (await c.query(
    "insert into public.customers (tenant_id, name) values ($1,'Settle Account Probe') returning id",
    [tenant],
  )).rows[0].id;

  // Seed a points balance directly on the ledger — customer_points_ledger has no
  // INSERT policy for `authenticated`, every real write goes through a SECURITY
  // DEFINER RPC, so this is table-owner seeding exactly like _verify-points.mjs does.
  await c.query("set local role postgres");
  await c.query(
    `insert into public.customer_points_ledger (tenant_id, customer_id, delta, reason, ref_type, ref_id, created_by)
     values ($1,$2,40,'adjusted',null,null,$3)`,
    [tenant, cust, owner],
  );
  await asUser(SANDBOX_AUTH);
  const before = (await c.query("select points_balance from public.customers where id=$1", [cust])).rows[0].points_balance;
  check("seeded 40 points before settling", before, 40);

  // The same call settleAccountAction makes (backOfficeTillId → back_office_till RPC):
  // rolls a stale desk session forward to today rather than reusing whatever
  // physical-tablet-style session happens to be left open in the sandbox tenant.
  const till = (await c.query("select * from public.back_office_till()")).rows[0];
  check("the back-office till is open", till.status, "open");

  console.log("▸ two invoices: Rs 30 (older) and Rs 50 (newer)");
  const draft1 = (await c.query(
    "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: cust }), JSON.stringify([mkLine(30)])],
  )).rows[0];
  const inv1 = (await c.query("select * from public.issue_document($1::uuid, null, null, null)", [draft1.id])).rows[0];
  check("invoice 1 total", inv1.total_incl, "30.00");

  const draft2 = (await c.query(
    "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: cust }), JSON.stringify([mkLine(50)])],
  )).rows[0];
  const inv2 = (await c.query("select * from public.issue_document($1::uuid, null, null, null)", [draft2.id])).rows[0];
  check("invoice 2 total", inv2.total_incl, "50.00");

  // planSettlement's plan for (points=40, method=cash): inv1 gets a Rs 30 points leg
  // (fully covering it), inv2 gets a Rs 10 points leg then a Rs 40 cash leg.
  console.log("▸ settling both: Rs 40 in points (spans the invoice boundary) + cash for the rest");
  await c.query(
    "select * from public.record_payment($1::uuid, 'points'::payment_method, 30, null, null, $2::uuid, null, $3)",
    [inv1.id, till.id, "probe-settle-inv1-points"],
  );
  await c.query(
    "select * from public.record_payment($1::uuid, 'points'::payment_method, 10, null, null, $2::uuid, null, $3)",
    [inv2.id, till.id, "probe-settle-inv2-points"],
  );
  await c.query(
    "select * from public.record_payment($1::uuid, 'cash'::payment_method, 40, 40, null, $2::uuid, null, $3)",
    [inv2.id, till.id, "probe-settle-inv2-cash"],
  );

  const status1 = (await c.query("select status, amount_paid from public.documents where id=$1", [inv1.id])).rows[0];
  check("invoice 1 is fully paid", status1.status, "paid");
  check("invoice 1 amount_paid", status1.amount_paid, "30.00");
  const status2 = (await c.query("select status, amount_paid from public.documents where id=$1", [inv2.id])).rows[0];
  check("invoice 2 is fully paid", status2.status, "paid");
  check("invoice 2 amount_paid", status2.amount_paid, "50.00");

  const afterBalance = (await c.query("select points_balance from public.customers where id=$1", [cust])).rows[0].points_balance;
  check("exactly 40 points were spent (40 seeded - 40 spent = 0)", afterBalance, 0);

  const redeemed = await c.query(
    "select ref_id, delta from public.customer_points_ledger where reason='redeemed' and customer_id=$1",
    [cust],
  );
  check("two redeemed ledger rows, one per invoice", redeemed.rows.length, 2);
  // Both land in the same transaction, so insertion order isn't meaningful — compare
  // as a set: exactly -30 against invoice 1 and -10 against invoice 2, either order.
  const redeemedSet = redeemed.rows.map((r) => `${r.ref_id}:${r.delta}`).sort().join(",");
  const wantSet = [`${inv1.id}:-30`, `${inv2.id}:-10`].sort().join(",");
  check("redeemed rows are exactly -30 on invoice 1 and -10 on invoice 2", redeemedSet, wantSet);

  const payments = await c.query(
    "select document_id, method, amount from public.payments where document_id in ($1,$2) order by created_at",
    [inv1.id, inv2.id],
  );
  check("three payment rows total (one on inv1, two on inv2)", payments.rows.length, 3);

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
