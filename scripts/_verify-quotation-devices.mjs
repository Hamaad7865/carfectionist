// Rolled-back verification for quotation-only devices
// (20260803000020_quotation_only_devices.sql). Runs as `authenticated`
// impersonating the owner, then ROLLS BACK — nothing persists.
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

  console.log("▸ a newly registered device takes payments");
  const dev = (await c.query("select * from public.register_device('TAB-QO1', 'SM-X200', '1.9.0', false)")).rows[0];
  check("takes_payments defaults true", dev.takes_payments, "true");

  console.log("▸ a paying device opens a till normally");
  const sid = (await c.query("select id from public.open_cash_session('TAB-QO1', 500)")).rows[0].id;
  check("session opened", sid != null, "true");

  console.log("▸ the switch is refused while that device holds an open session");
  try {
    await c.query("savepoint sp0");
    await c.query("select public.set_device_takes_payments($1::uuid, false)", [dev.id]);
    check("flip refused with a session open", "allowed", "refused");
  } catch (e) {
    await c.query("rollback to savepoint sp0");
    check("flip refused with a session open", "refused", "refused");
    check("message names the fix", /close the open service/.test(e.message), "true");
  }

  console.log("▸ close the service, then the switch is allowed");
  await c.query("select public.close_cash_session($1::uuid, 500)", [sid]);
  const off = (await c.query("select takes_payments from public.set_device_takes_payments($1::uuid, false)", [dev.id])).rows[0];
  check("switched to quotation only", off.takes_payments, "false");
  const audit = await c.query(
    "select count(*)::int n from audit_events where event_type='device_payments_disabled' and device_id='TAB-QO1'");
  check("device_payments_disabled audited", audit.rows[0].n, 1);

  console.log("▸ a quotation device cannot open a till");
  try {
    await c.query("savepoint sp1");
    await c.query("select public.open_cash_session('TAB-QO1', 500)");
    check("till refused on a quotation device", "allowed", "refused");
  } catch (e) {
    await c.query("rollback to savepoint sp1");
    check("till refused on a quotation device", "refused", "refused");
    check("message names the paying terminal", /open the till on the paying terminal/.test(e.message), "true");
  }

  console.log("▸ unregistered device codes are unaffected");
  const unreg = (await c.query("select id from public.open_cash_session('TAB-QO-UNREG', 100)")).rows[0].id;
  check("unregistered device still opens", unreg != null, "true");

  // The web opens its tills as the literal code 'back-office'. register_device will
  // accept that string from anyone, so a devices row could exist under it — and if it
  // were ever flagged quotation-only, an unqualified guard would refuse every web till
  // in the tenant, not one tablet. The guard excludes the name; prove it.
  console.log("▸ a device row named 'back-office' cannot lock the web out");
  const bo = (await c.query("select * from public.register_device('back-office', null, null, true)")).rows[0];
  await c.query("select public.set_device_takes_payments($1::uuid, false)", [bo.id]);
  const boSess = (await c.query("select id from public.open_cash_session('back-office', 0)")).rows[0].id;
  check("the web back office still opens its till", boSess != null, "true");

  console.log("▸ a null answer is a sentence, not a constraint error");
  try {
    await c.query("savepoint sp3");
    await c.query("select public.set_device_takes_payments($1::uuid, null)", [dev.id]);
    check("null p_takes refused", "allowed", "refused");
  } catch (e) {
    await c.query("rollback to savepoint sp3");
    check("null p_takes refused", "refused", "refused");
    check("message is readable, not a constraint violation", /say whether this device takes payments/.test(e.message), "true");
  }

  console.log("▸ the switch fails closed on a device that is not ours");
  try {
    await c.query("savepoint sp2");
    await c.query("select public.set_device_takes_payments('00000000-0000-0000-0000-000000000000'::uuid, false)");
    check("unknown device refused", "allowed", "refused");
  } catch (e) {
    await c.query("rollback to savepoint sp2");
    check("unknown device refused", "refused", "refused");
    check("message says device not found", /device not found/.test(e.message), "true");
  }

  // This migration rebuilds open_cash_session wholesale, so it can silently drop
  // anything an earlier migration added to it. It already did once: the first draft
  // was copied from 20260714000006 and lost the per-day advisory lock that
  // 20260715000010 (#9) added to stop two devices minting the same service_no.
  // Assert on the DEPLOYED body so the next rebuild cannot lose it again.
  console.log("▸ the service_no advisory lock survived the rebuild");
  const def = (await c.query(
    "select pg_get_functiondef('public.open_cash_session(text,numeric)'::regprocedure) d")).rows[0].d;
  check("advisory lock still in open_cash_session", /pg_advisory_xact_lock/.test(def), "true");

  console.log("▸ switching back restores the till");
  const on = (await c.query("select takes_payments from public.set_device_takes_payments($1::uuid, true)", [dev.id])).rows[0];
  check("switched back", on.takes_payments, "true");
  const sid2 = (await c.query("select id from public.open_cash_session('TAB-QO1', 500)")).rows[0].id;
  check("opens again", sid2 != null, "true");

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
