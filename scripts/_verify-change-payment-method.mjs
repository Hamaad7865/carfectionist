// change_payment_method — DB probe. Always ROLLS BACK.
//   node scripts/_verify-change-payment-method.mjs
// Runs in the SANDBOX tenant (no trading day today, so issue_document works).
//
// Proves the carve-out is safe: a method swap nets the invoice to the SAME
// figure, never touches points, and honours the cash guard rails.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const SANDBOX_AUTH = "b729191b-1159-4d46-88c7-3c9aceb5e664"; // TEST Sandbox (owner)

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};
const asRefusal = (out, want, token) => (String(out).includes(want) ? token : out);
const mkLine = (over) => ({
  product_id: null, title: "CPM probe line", description: null, qty: 1, unit_price: 1000,
  discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15,
  sort_order: 0, line_kind: "product", ...over,
});

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
const asUser = async (authUid) => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: authUid, role: "authenticated" }),
  ]);
};
const newInvoice = async (custId, tillId, lines = [mkLine({})]) => {
  const d = (await c.query("select * from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ doc_type: "invoice", customer_id: custId }), JSON.stringify(lines),
  ])).rows[0];
  return (await c.query("select * from public.issue_document($1::uuid, null, null, $2::uuid)", [d.id, tillId])).rows[0];
};
const docState = async (id) =>
  (await c.query("select status, amount_paid, total_incl from public.documents where id=$1", [id])).rows[0];
const payRows = async (docId) =>
  (await c.query(
    "select method, amount::float8 amt, external_ref, reverses_payment_id from public.payments where document_id=$1 order by created_at, amount desc",
    [docId],
  )).rows;

try {
  await c.query("begin");
  await asUser(SANDBOX_AUTH);
  const tenant = (await c.query("select app.current_tenant_id() as t")).rows[0].t;

  console.log("▸ 0. the RPC exists");
  const installed = (await c.query(
    "select to_regprocedure('public.change_payment_method(uuid, payment_method, text, uuid, text)') is not null ok",
  )).rows[0].ok;
  check("change_payment_method installed", installed, true);
  if (!installed) throw new Error("RPC not installed — run: node scripts/db-exec.mjs supabase/migrations/20260831000010_a_receipt_can_change_how_it_was_paid.sql");

  const cust = (await c.query(
    "insert into public.customers (tenant_id, name) values ($1,'CPM Probe Customer') returning id", [tenant],
  )).rows[0].id;
  const till = (await c.query(
    "select id, status from public.open_cash_session($1, 0)", [`SANDBOX-CPM-${Date.now()}`],
  )).rows[0];
  check("a till is open for the sandbox", till.status, "open");

  // ── 1. Card → Juice on a paid invoice ─────────────────────────────────────
  console.log("▸ 1. Card → Juice: same amount, invoice stays paid");
  const inv1 = await newInvoice(cust, till.id);
  check("invoice total_incl", inv1.total_incl, "1150.00");
  const card1 = (await c.query(
    "select id from public.record_payment($1::uuid,'card'::payment_method,1150,null,'PDQ-1',$2::uuid,null,null)",
    [inv1.id, till.id],
  )).rows[0];
  check("invoice paid by card", (await docState(inv1.id)).status, "paid");
  const ptsBefore = (await c.query(
    "select coalesce(sum(delta),0) s, count(*) n from public.customer_points_ledger where customer_id=$1", [cust],
  )).rows[0];

  const juice1 = (await c.query(
    "select id, method, amount::float8 amt, external_ref from public.change_payment_method($1::uuid,'juice'::payment_method,'JUICE-1',$2::uuid,null)",
    [card1.id, till.id],
  )).rows[0];
  check("returned row is the new juice line", juice1.method, "juice");
  check("new line keeps the amount", juice1.amt, 1150);
  check("new line carries the new ref", juice1.external_ref, "JUICE-1");

  const rows1 = await payRows(inv1.id);
  check("three payment rows now", rows1.length, 3);
  check("  +card row", rows1.some((r) => r.method === "card" && r.amt === 1150 && !r.reverses_payment_id), true);
  check("  -card mirror", rows1.some((r) => r.method === "card" && r.amt === -1150 && r.reverses_payment_id === card1.id), true);
  check("  +juice row", rows1.some((r) => r.method === "juice" && r.amt === 1150), true);

  const st1 = await docState(inv1.id);
  check("invoice still paid", st1.status, "paid");
  check("amount_paid unchanged", st1.amount_paid, "1150.00");
  const sumPaid = (await c.query("select coalesce(sum(amount),0)::float8 s from public.payments where document_id=$1", [inv1.id])).rows[0].s;
  check("sum of payment rows = total", sumPaid, 1150);

  console.log("▸ 2. points earned are untouched (no unwind / re-award)");
  const ptsAfter = (await c.query(
    "select coalesce(sum(delta),0) s, count(*) n from public.customer_points_ledger where customer_id=$1", [cust],
  )).rows[0];
  check("points ledger sum unchanged", ptsAfter.s, ptsBefore.s);
  check("points ledger row count unchanged", ptsAfter.n, ptsBefore.n);

  console.log("▸ 3. an audit row was written");
  const audit = (await c.query(
    "select payload->>'from_method' f, payload->>'to_method' t from public.audit_events where event_type='payment_method_changed' and ref_id=$1 order by created_at desc limit 1",
    [card1.id],
  )).rows[0];
  check("audit from_method", audit?.f, "card");
  check("audit to_method", audit?.t, "juice");

  // ── 4. new method needs its reference ─────────────────────────────────────
  console.log("▸ 4. Card → Juice with NO reference is refused");
  const inv4 = await newInvoice(cust, till.id);
  const card4 = (await c.query(
    "select id from public.record_payment($1::uuid,'card'::payment_method,1150,null,'PDQ-4',$2::uuid,null,null)", [inv4.id, till.id],
  )).rows[0];
  let noRef = "accepted";
  await c.query("savepoint s4");
  try {
    await c.query("select from public.change_payment_method($1::uuid,'juice'::payment_method,null,$2::uuid,null)", [card4.id, till.id]);
  } catch (e) { noRef = e.message; }
  await c.query("rollback to savepoint s4");
  check("no-ref juice refused", asRefusal(noRef, "requires an external reference", "refused"), "refused");

  // ── 5. no-op / points / credit ───────────────────────────────────────────
  console.log("▸ 5. no-op and points/credit are refused");
  let sameMethod = "accepted";
  await c.query("savepoint s5a");
  try {
    await c.query("select from public.change_payment_method($1::uuid,'card'::payment_method,'X',$2::uuid,null)", [card4.id, till.id]);
  } catch (e) { sameMethod = e.message; }
  await c.query("rollback to savepoint s5a");
  check("card → card refused", asRefusal(sameMethod, "already the payment method", "refused"), "refused");

  let toPoints = "accepted";
  await c.query("savepoint s5b");
  try {
    await c.query("select from public.change_payment_method($1::uuid,'points'::payment_method,null,$2::uuid,null)", [card4.id, till.id]);
  } catch (e) { toPoints = e.message; }
  await c.query("rollback to savepoint s5b");
  check("card → points refused", asRefusal(toPoints, "cannot change a payment to", "refused"), "refused");

  // ── 6. till closed ───────────────────────────────────────────────────────
  console.log("▸ 6. a closed till (no open sibling) is refused");
  const closedTill = (await c.query(
    "select id from public.open_cash_session($1, 0)", [`SANDBOX-CPM-CLOSED-${Date.now()}`],
  )).rows[0];
  const inv6 = await newInvoice(cust, closedTill.id);
  const card6 = (await c.query(
    "select id from public.record_payment($1::uuid,'card'::payment_method,1150,null,'PDQ-6',$2::uuid,null,null)", [inv6.id, closedTill.id],
  )).rows[0];
  await c.query("select from public.close_cash_session($1::uuid, 0)", [closedTill.id]);
  let closed = "accepted";
  await c.query("savepoint s6");
  try {
    await c.query("select from public.change_payment_method($1::uuid,'juice'::payment_method,'J6',null,null)", [card6.id]);
  } catch (e) { closed = e.message; }
  await c.query("rollback to savepoint s6");
  check("closed-till change refused", asRefusal(closed, "till this was paid on is closed", "refused"), "refused");

  // ── 7. cash carve-out ────────────────────────────────────────────────────
  console.log("▸ 7. changing AWAY from cash needs a manager; TO cash is fine for a cashier");
  const inv7 = await newInvoice(cust, till.id);
  const cash7 = (await c.query(
    "select id from public.record_payment($1::uuid,'cash'::payment_method,1150,1150,null,$2::uuid,null,null)", [inv7.id, till.id],
  )).rows[0];

  // cashier cannot turn cash into card
  await c.query("savepoint s7a");
  await c.query("update public.app_users set role='cashier' where auth_user_id=$1", [SANDBOX_AUTH]);
  let cashAway = "accepted";
  try {
    await c.query("select from public.change_payment_method($1::uuid,'card'::payment_method,'C7',$2::uuid,null)", [cash7.id, till.id]);
  } catch (e) { cashAway = e.message; }
  await c.query("rollback to savepoint s7a");
  check("cashier: cash → card refused", asRefusal(cashAway, "insufficient privileges", "refused"), "refused");

  // manager (owner) CAN
  const mgrAway = (await c.query(
    "select method from public.change_payment_method($1::uuid,'card'::payment_method,'C7-mgr',$2::uuid,null)", [cash7.id, till.id],
  )).rows[0];
  check("owner: cash → card allowed", mgrAway.method, "card");
  check("  invoice still paid after cash → card", (await docState(inv7.id)).status, "paid");

  // cashier CAN turn card into cash (drawer gains an expectation — safe)
  const inv7b = await newInvoice(cust, till.id);
  const card7b = (await c.query(
    "select id from public.record_payment($1::uuid,'card'::payment_method,1150,null,'PDQ-7b',$2::uuid,null,null)", [inv7b.id, till.id],
  )).rows[0];
  await c.query("savepoint s7b");
  await c.query("update public.app_users set role='cashier' where auth_user_id=$1", [SANDBOX_AUTH]);
  const toCash = (await c.query(
    "select method, tendered::float8 t, change_given::float8 cg from public.change_payment_method($1::uuid,'cash'::payment_method,null,$2::uuid,null)",
    [card7b.id, till.id],
  )).rows[0];
  check("cashier: card → cash allowed", toCash.method, "cash");
  check("  cash row tender defaults to exact", toCash.t, 1150);
  check("  cash row change is zero", toCash.cg, 0);
  await c.query("rollback to savepoint s7b");

  // ── 8. idempotency ───────────────────────────────────────────────────────
  console.log("▸ 8. the same idempotency key does not swap twice");
  const inv8 = await newInvoice(cust, till.id);
  const card8 = (await c.query(
    "select id from public.record_payment($1::uuid,'card'::payment_method,1150,null,'PDQ-8',$2::uuid,null,null)", [inv8.id, till.id],
  )).rows[0];
  const k = `cpm-probe-${Date.now()}`;
  const first = (await c.query(
    "select id from public.change_payment_method($1::uuid,'juice'::payment_method,'J8',$2::uuid,$3)", [card8.id, till.id, k],
  )).rows[0];
  const second = (await c.query(
    "select id from public.change_payment_method($1::uuid,'juice'::payment_method,'J8',$2::uuid,$3)", [card8.id, till.id, k],
  )).rows[0];
  check("same key returns the same row", second.id, first.id);
  const rows8 = await payRows(inv8.id);
  check("still exactly one -card mirror", rows8.filter((r) => r.method === "card" && r.amt === -1150).length, 1);
  check("still exactly one +juice row", rows8.filter((r) => r.method === "juice").length, 1);
  check("invoice still paid, once", (await docState(inv8.id)).status, "paid");

  // ── 9. a partial payment: only that row is mirrored ───────────────────────
  console.log("▸ 9. one row of a split is changed, the rest untouched");
  const inv9 = await newInvoice(cust, till.id, [mkLine({ unit_price: 2000 })]); // 2300 incl
  check("split invoice total", inv9.total_incl, "2300.00");
  const cardHalf = (await c.query(
    "select id from public.record_payment($1::uuid,'card'::payment_method,920,null,'PDQ-9',$2::uuid,null,null)", [inv9.id, till.id],
  )).rows[0];
  const cashRest = (await c.query(
    "select id from public.record_payment($1::uuid,'cash'::payment_method,1380,1380,null,$2::uuid,null,null)", [inv9.id, till.id],
  )).rows[0];
  check("split invoice paid", (await docState(inv9.id)).status, "paid");
  await c.query(
    "select from public.change_payment_method($1::uuid,'juice'::payment_method,'J9',$2::uuid,null)", [cardHalf.id, till.id],
  );
  const rows9 = await payRows(inv9.id);
  check("the cash row is still there untouched", rows9.some((r) => r.method === "cash" && r.amt === 1380 && r.reverses_payment_id === null), true);
  check("the card row is mirrored", rows9.some((r) => r.method === "card" && r.amt === -920 && r.reverses_payment_id === cardHalf.id), true);
  check("a juice 920 row was added", rows9.some((r) => r.method === "juice" && r.amt === 920), true);
  check("split invoice still paid", (await docState(inv9.id)).status, "paid");
  const sum9 = (await c.query("select coalesce(sum(amount),0)::float8 s from public.payments where document_id=$1", [inv9.id])).rows[0].s;
  check("split sum still = total", sum9, 2300);

  await c.query("rollback");
  console.log(`\n${failures === 0 ? "✓ ALL PASSED" : `✗ ${failures} FAILURE(S)`}`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (err) {
  await c.query("rollback").catch(() => {});
  console.error("✗ probe threw:", err.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
