// Verifies 20261001000010_shared_single_drawer.sql against the LIVE DB,
// entirely inside ONE BEGIN/ROLLBACK (nothing survives).
//
// One drawer: at most one open session per trading day, whoever opened it.
//   • shop_till() returns today's open till (any device), or null.
//   • back_office_till() joins that same session — never a parallel till.
//   • a second open raises 'already open — join it'.
//   • a stale open blocks new opens with the strict message (no roll-forward).
//   • close_service still cuts a Z on the shared session (services[] = 1 block).
//
// The script adapts to live state: if today's till is already open it asserts
// the join read-only; if a stale till is open it asserts the strict refusal.
// Only when the drawer is fully closed does it run the full mutation flow.
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);

const TENANT = "11111111-1111-4111-8111-000000000001";
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh's AUTH uid → JWT claims

const c = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed = true; };
const asOwner = () => c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" })]);
const todayOpen = () => c.query(
  `select s.id, s.device_id from public.cash_sessions s
     join public.trading_days d on d.id = s.trading_day_id
    where s.tenant_id = $1 and s.status = 'open' and d.business_date = app.mu_today()
    order by s.opened_at limit 1`, [TENANT]);
const staleOpen = () => c.query(
  `select s.id from public.cash_sessions s
     join public.trading_days d on d.id = s.trading_day_id
    where s.tenant_id = $1 and s.status = 'open' and d.business_date < app.mu_today()
    order by d.business_date limit 1`, [TENANT]);

try {
  await c.query("begin");
  await asOwner();

  const stale = (await staleOpen()).rows;
  const open = (await todayOpen()).rows;

  if (stale.length > 0) {
    // A stale drawer owns the shop until counted: new opens are refused…
    await c.query("savepoint sp_strict");
    let err = "";
    try { await c.query(`select * from public.open_cash_session('TEST-SHARED', 0)`); }
    catch (e) { err = e.message; }
    await c.query("rollback to savepoint sp_strict");
    check("stale open blocks a new till (strict, no roll-forward)", /still open/.test(err), err || "NO ERROR RAISED");
    // …and the shared lookup hides it (it still needs counting on the terminal).
    if (open.length > 0) {
      const { rows: [shop] } = await c.query(`select * from public.shop_till()`);
      check("shop_till() returns today's open till", shop?.id === open[0].id, shop?.id ?? "null");
    } else {
      const { rows: [shop] } = await c.query(`select * from public.shop_till()`);
      check("shop_till() is null when today has no open till", shop == null, JSON.stringify(shop));
    }
    console.log("(stale drawer live — mutation flow skipped; close it on the terminal first)");
  } else if (open.length > 0) {
    // Live till open: both sides must resolve to it, and a parallel open fails.
    const { rows: [shop] } = await c.query(`select * from public.shop_till()`);
    check("shop_till() returns the open till", shop?.id === open[0].id, `${shop?.id} on ${shop?.device_id}`);
    const { rows: [desk] } = await c.query(`select * from public.back_office_till()`);
    check("back_office_till() joins the same session", desk?.id === open[0].id, desk?.id ?? "null");
    await c.query("savepoint sp_dup");
    let err = "";
    try { await c.query(`select * from public.open_cash_session('TEST-SHARED', 0)`); }
    catch (e) { err = e.message; }
    await c.query("rollback to savepoint sp_dup");
    check("a second open is refused (join it)", /already open/.test(err), err || "NO ERROR RAISED");
    console.log("(till live-open — mutation flow skipped)");
  } else {
    // Drawer fully closed: run the whole lifecycle in-txn.
    const { rows: [s] } = await c.query(`select * from public.open_cash_session('TEST-SHARED', 2000)`);
    check("first open mints the day's till", s?.status === "open", `${s?.device_id} service ${s?.service_no}`);
    const { rows: [shop] } = await c.query(`select * from public.shop_till()`);
    check("shop_till() sees it", shop?.id === s.id, shop?.id ?? "null");
    const { rows: [desk] } = await c.query(`select * from public.back_office_till()`);
    check("back_office_till() joins it (no parallel till)", desk?.id === s.id, desk?.id ?? "null");
    await c.query("savepoint sp_dup");
    let err = "";
    try { await c.query(`select * from public.open_cash_session('back-office', 0)`); }
    catch (e) { err = e.message; }
    await c.query("rollback to savepoint sp_dup");
    check("a second open is refused (join it)", /already open/.test(err), err || "NO ERROR RAISED");

    // Stale strictness, staged then unwound inside the txn.
    await c.query("savepoint sp_stale");
    const staleDate = "2020-01-02";
    const clash = (await c.query(`select 1 from public.trading_days where tenant_id=$1 and business_date=$2`, [TENANT, staleDate])).rows;
    if (clash.length === 0) {
      const { rows: [{ id: appUser }] } = await c.query(`select id from public.app_users where tenant_id=$1 and role='owner' limit 1`, [TENANT]);
      const { rows: [oldDay] } = await c.query(
        `insert into public.trading_days (tenant_id, business_date, status) values ($1,$2,'open') returning id`, [TENANT, staleDate]);
      await c.query(
        `insert into public.cash_sessions (tenant_id, device_id, opened_by, opening_float, status, trading_day_id, service_no)
         values ($1,'TEST-STALE',$2,0,'open',$3,1)`, [TENANT, appUser, oldDay.id]);
      let serr = "";
      try { await c.query(`select * from public.open_cash_session('TEST-SHARED2', 0)`); }
      catch (e) { serr = e.message; }
      check("a stale open blocks new opens (strict)", /still open/.test(serr), serr || "NO ERROR RAISED");
    } else {
      console.log("(stale-date clash — strict subtest skipped)");
    }
    await c.query("rollback to savepoint sp_stale");

    // The shared session still closes and cuts its Z exactly like before.
    const { rows: [z] } = await c.query(`select * from public.close_service($1::uuid, 2000, '{}'::text[], null)`, [s.id]);
    const blocks = z?.totals?.services ?? [];
    check("close_service cuts the Z on the shared session",
      typeof z?.number === "string" && blocks.length === 1 && blocks[0].service_no === s.service_no && blocks[0].provisional === false,
      `${z?.number} · ${blocks.length} service block(s)`);
  }
} catch (err) {
  failed = true;
  console.error("✗ threw:", err.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failed ? "\nFAILED (rolled back)" : "\nAll checks passed (rolled back — nothing persisted).");
process.exitCode = failed ? 1 : 0;
