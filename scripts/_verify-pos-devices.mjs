// Rolled-back verification for the Point of Sale module DB layer
// (20260711000004_pos_devices.sql). Runs as `authenticated` impersonating the
// owner, then ROLLS BACK — nothing persists.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner auth uid)
const CUSTOMER = "9f22f6b7-48e2-4a20-97e6-89b18d119aa4";

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};
const checkTrue = (label, got) => check(label, !!got, true);

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: AUTH, role: "authenticated" })]);

  console.log("▸ register_device — first launch");
  const d1 = await c.query("select * from public.register_device('TAB-TEST', 'NEOSTRA D2', '1.4.0', false)");
  check("device_code", d1.rows[0].device_code, "TAB-TEST");
  check("model", d1.rows[0].model, "NEOSTRA D2");
  const started = await c.query(
    "select count(*)::int n from audit_events where event_type='terminal_started' and device_id='TAB-TEST'");
  check("terminal_started audited", started.rows[0].n, 1);

  console.log("▸ register_device — version change on relaunch");
  await c.query("select public.register_device('TAB-TEST', 'NEOSTRA D2', '1.5.0', false)");
  const ver = await c.query(
    "select payload->>'from' as f, payload->>'to' as t from audit_events where event_type='app_version_changed' and device_id='TAB-TEST'");
  check("version change from", ver.rows[0]?.f, "1.4.0");
  check("version change to", ver.rows[0]?.t, "1.5.0");

  console.log("▸ register_device — heartbeat is silent");
  const before = await c.query("select count(*)::int n from audit_events where device_id='TAB-TEST'");
  await c.query("select public.register_device('TAB-TEST', null, null, true)");
  const after = await c.query("select count(*)::int n from audit_events where device_id='TAB-TEST'");
  check("no new audit rows on heartbeat", after.rows[0].n, before.rows[0].n);

  console.log("▸ rename + deactivate");
  const dev = d1.rows[0];
  const ren = await c.query("select display_name from public.rename_device($1::uuid, 'Caisse Test')", [dev.id]);
  check("renamed", ren.rows[0].display_name, "Caisse Test");
  const off = await c.query("select is_active from public.set_device_active($1::uuid, false)", [dev.id]);
  check("deactivated", off.rows[0].is_active, "false");
  const offAudit = await c.query("select count(*)::int n from audit_events where event_type='device_disabled' and device_id='TAB-TEST'");
  check("device_disabled audited", offAudit.rows[0].n, 1);

  console.log("▸ all-methods session linkage leaves drawer math untouched");
  const sess = await c.query("select id from public.open_cash_session('TAB-TEST', 500)");
  const sid = sess.rows[0].id;
  const prod = await c.query("select id from products where is_stocked and is_active limit 1");
  const draft = await c.query("select id from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ doc_type: "invoice", customer_id: CUSTOMER }),
    JSON.stringify([{ product_id: prod.rows[0].id, title: "X", qty: 1, unit_price: 1500, vat_rate: 15 }]),
  ]);
  await c.query("select public.issue_document($1::uuid, null, null)", [draft.rows[0].id]);
  // cash 1000 + card 725 (total 1725 = 1500*1.15), BOTH linked to the session
  await c.query(
    "select public.record_payment($1::uuid, 'cash', 1000, 1000, null, $2::uuid, null, null)", [draft.rows[0].id, sid]);
  await c.query(
    "select public.record_payment($1::uuid, 'card', 725, null, 'CARD-1', $2::uuid, null, null)", [draft.rows[0].id, sid]);
  const closed = await c.query("select expected_cash, variance from public.close_cash_session($1::uuid, 1500)", [sid]);
  check("expected = float 500 + CASH 1000 only", closed.rows[0].expected_cash, "1500.00");
  check("variance 0 (card excluded)", closed.rows[0].variance, "0.00");

  console.log("▸ close_period");
  const now = await c.query("select to_char(now() at time zone 'Indian/Mauritius', 'YYYY-MM') p");
  try {
    await c.query("savepoint sp0");
    await c.query("select public.close_period($1)", [now.rows[0].p]);
    check("current month rejected", "allowed", "rejected");
  } catch { await c.query("rollback to savepoint sp0"); check("current month rejected", "rejected", "rejected"); }
  const prev = await c.query("select to_char((now() at time zone 'Indian/Mauritius')::date - interval '1 month', 'YYYY-MM') p");
  const period = prev.rows[0].p;
  const cp = await c.query("select period, totals from public.close_period($1)", [period]);
  check("period stored", cp.rows[0].period, period);
  checkTrue("totals has invoices key", cp.rows[0].totals?.invoices != null);
  checkTrue("totals has payments_by_method", cp.rows[0].totals?.payments_by_method != null);
  const pcAudit = await c.query("select count(*)::int n from audit_events where event_type='period_closed'");
  check("period_closed audited", pcAudit.rows[0].n, 1);
  try {
    await c.query("savepoint sp1");
    await c.query("select public.close_period($1)", [period]);
    check("double close rejected", "allowed", "rejected");
  } catch { await c.query("rollback to savepoint sp1"); check("double close rejected", "rejected", "rejected"); }

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
