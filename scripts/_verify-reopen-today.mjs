// Proves reopen_today: a manager reopens the day the till itself refused, a cashier
// cannot, a blank reason is refused, a second tap is not an error, and the reopen is
// audited. Then proves the till actually opens afterwards — the whole point.
// Runs inside a transaction and ROLLS BACK — nothing here survives.
//   node scripts/_verify-reopen-today.mjs
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

const MANAGER = "e3a8e576-2d93-4876-8005-d33569bdecd2"; // Anshika
requireEnv("SUPABASE_DB_URL", DB_URL);

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
let ok = true;
const check = (n, cond, d = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`);
  if (!cond) ok = false;
};
const as = (authId) =>
  c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: authId, role: "authenticated" }),
  ]);

try {
  await c.query("begin");
  await as(MANAGER);
  const tenant = (await c.query("select app.current_tenant_id() t")).rows[0].t;

  // Put the day in the state the shop was actually in: closed, with a day-Z cut.
  await c.query(
    `update trading_days set status='closed', closed_at=now()
      where tenant_id=$1 and business_date=app.mu_today()`,
    [tenant],
  );

  // ── the till refuses, exactly as it did for the late customer ──────────────
  let refused = "";
  await c.query("savepoint s0");
  try {
    await c.query("select public.open_cash_session('TAB-VERIFY', 0)");
  } catch (e) { refused = e.message; }
  await c.query("rollback to savepoint s0");
  check("a closed day refuses the till", /is closed — reopen it/.test(refused), refused);

  // ── a blank reason is refused ──────────────────────────────────────────────
  let blank = false;
  await c.query("savepoint s1");
  try { await c.query("select public.reopen_today('   ')"); }
  catch (e) { blank = /reason is required/i.test(e.message); }
  await c.query("rollback to savepoint s1");
  check("a blank reason is refused", blank);

  // ── a cashier cannot reopen ────────────────────────────────────────────────
  // The role gate IS the security model here (there is no PIN step-up), so it gets
  // tested for real: demote a live user to cashier inside the transaction rather
  // than skip the case when the roster happens to have no cashier on it.
  let denied = false;
  await c.query("savepoint s2");
  try {
    await c.query("update app_users set role='cashier' where auth_user_id=$1", [MANAGER]);
    await c.query("select public.reopen_today('trying it on')");
  } catch (e) { denied = /insufficient privileges/i.test(e.message); }
  await c.query("rollback to savepoint s2");
  check("a cashier is refused", denied);

  // ── the manager reopens ────────────────────────────────────────────────────
  const before = (
    await c.query(
      "select reopened_count from trading_days where tenant_id=$1 and business_date=app.mu_today()",
      [tenant],
    )
  ).rows[0].reopened_count;
  const day = (
    await c.query(
      `with s as materialized (select public.reopen_today($1) as r)
       select (r).id, (r).status, (r).reopened_count from s`,
      ["Customer arrived after the close."],
    )
  ).rows[0];
  check("the day is open again", day.status === "open", `status ${day.status}`);
  check("the reopen is counted", day.reopened_count === before + 1, `${before} → ${day.reopened_count}`);

  const audit = (
    await c.query(
      `select payload->>'reason' as reason from audit_events
        where event_type='day_reopened' and ref_id=$1 order by created_at desc limit 1`,
      [day.id],
    )
  ).rows[0];
  check("the reason is audited", audit?.reason === "Customer arrived after the close.", audit?.reason);

  // ── a second tap is not an error ───────────────────────────────────────────
  const again = (
    await c.query(
      `with s as materialized (select public.reopen_today('again') as r)
       select (r).status, (r).reopened_count from s`,
    )
  ).rows[0];
  check("a second tap is idempotent, not a second reopen",
    again.status === "open" && again.reopened_count === day.reopened_count,
    `count ${again.reopened_count}`);

  // ── and now the till actually opens ────────────────────────────────────────
  const till = (
    await c.query(
      `with s as materialized (select public.open_cash_session('TAB-VERIFY', 0) as r)
       select (r).status from s`,
    )
  ).rows[0];
  check("the till opens after the reopen", till.status === "open", till.status);

  await c.query("rollback");
  console.log(`\n${ok ? "PASS" : "FAIL"} — rolled back, nothing kept.`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("✗ error:", e.message);
  process.exit(1);
} finally {
  await c.end();
}
