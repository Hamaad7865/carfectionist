// Rolled-back verification for petty cash (20260712000001_till_movements.sql).
// Runs as `authenticated` impersonating the owner, then ROLLS BACK.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner auth uid)

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: AUTH, role: "authenticated" })]);

  // Go-live replaced the seed rows, so no customer id survives being hardcoded.
  // Probed under the owner's claims, so RLS keeps it inside their tenant.
  const cust = await c.query("select id from customers order by created_at, id limit 1");
  if (!cust.rows.length) throw new Error("this tenant has no customers — create one before running this probe");
  const CUSTOMER = cust.rows[0].id;

  console.log("▸ open a till (float 500) + one cash sale 1150");
  const sess = await c.query("select id, device_id from public.open_cash_session('TAB-PCT', 500)");
  const sid = sess.rows[0].id;
  const prod = await c.query("select id from products where is_stocked and is_active limit 1");
  const draft = await c.query("select id from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ doc_type: "invoice", customer_id: CUSTOMER }),
    JSON.stringify([{ product_id: prod.rows[0].id, title: "X", qty: 1, unit_price: 1000, vat_rate: 15 }]),
  ]);
  await c.query("select public.issue_document($1::uuid, null, null)", [draft.rows[0].id]);
  await c.query("select public.record_payment($1::uuid, 'cash', 1150, 1150, null, $2::uuid, null, null)", [draft.rows[0].id, sid]);

  console.log("▸ petty cash out 190 (\"brushes\")");
  const out = await c.query("select amount, reason from public.record_till_cash_out($1::uuid, 190, 'brushes', null)", [sid]);
  check("stored negative", out.rows[0].amount, "-190.00");
  check("reason kept", out.rows[0].reason, "brushes");
  const audit = await c.query(
    "select payload->>'amount' a, payload->>'reason' r, device_id from audit_events where event_type='till_cash_out'");
  check("audited amount", audit.rows[0]?.a, "190");
  check("audited on device", audit.rows[0]?.device_id, "TAB-PCT");

  console.log("▸ guards");
  try {
    await c.query("savepoint g1");
    await c.query("select public.record_till_cash_out($1::uuid, 5000, 'too much', null)", [sid]);
    check("over-drawer rejected (drawer holds 1460)", "allowed", "rejected");
  } catch (e) { await c.query("rollback to savepoint g1"); check("over-drawer rejected (drawer holds 1460)", "rejected", "rejected"); }
  try {
    await c.query("savepoint g2");
    await c.query("select public.record_till_cash_out($1::uuid, 100, '   ', null)", [sid]);
    check("blank reason rejected", "allowed", "rejected");
  } catch { await c.query("rollback to savepoint g2"); check("blank reason rejected", "rejected", "rejected"); }

  console.log("▸ idempotent replay");
  await c.query("select public.record_till_cash_out($1::uuid, 60, 'stamps', 'pct-key-1')", [sid]);
  await c.query("select public.record_till_cash_out($1::uuid, 60, 'stamps', 'pct-key-1')", [sid]);
  const cnt = await c.query("select count(*)::int n from till_movements where cash_session_id=$1 and reason='stamps'", [sid]);
  check("same key inserts once", cnt.rows[0].n, 1);

  console.log("▸ close math includes the outs");
  // drawer: 500 float + 1150 cash − 190 − 60 = 1400
  const closed = await c.query("select expected_cash, variance from public.close_cash_session($1::uuid, 1400)", [sid]);
  check("expected 1400", closed.rows[0].expected_cash, "1400.00");
  check("variance 0", closed.rows[0].variance, "0.00");

  await c.query("rollback");
  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`} (rolled back — nothing persisted)`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  try { await c.query("rollback"); } catch {}
  console.error("✗ verify error:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
