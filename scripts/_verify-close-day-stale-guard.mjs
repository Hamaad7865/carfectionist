// Verifies 20260730000060_close_day_stale_guard.sql against the LIVE DB, everything
// inside BEGIN/ROLLBACK — no test row survives.
//
// The bug: close_day answers an ALREADY-CLOSED day with its old frozen Z (retry
// idempotency). A register holding a stale day id — cached at screen entry before
// someone else closed the day, or before the date rolled — read that old Z as
// success while the CURRENT day stayed open. A newer trading day can only exist
// once the calendar moved on, so its existence proves the caller is stale.
//
//   1. STALE    — closing an already-closed day while a NEWER (open) day exists
//                 raises instead of replaying the old Z.
//   2. STALE-2  — same, when the newer day is itself already closed.
//   3. RETRY    — closing the LATEST closed day still hands back its frozen Z
//                 (the double-tap / lost-response path must keep working).
//   4. NORMAL   — closing an open day (no open tills) still cuts a fresh day-Z.
import { config } from "dotenv";
import pg from "pg";
config({ path: ".env" });

const TENANT = "11111111-1111-4111-8111-000000000001";
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh's AUTH uid — goes in JWT claims
let APP_USER; // an app_users.id for closed_by FKs — probed live below

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL.trim(), ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const asOwner = () =>
  c.query(`select set_config('request.jwt.claims', $1, true)`, // txn-local claims
    [JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" })]);

/** A trading day on a far-future date (dodges unique(tenant, business_date) vs real rows). */
async function mkDay(date, status) {
  const { rows: [d] } = await c.query(
    `insert into public.trading_days (tenant_id, business_date, status, closed_at, closed_by)
     values ($1, $2, $3, case when $3 = 'closed' then now() end,
             case when $3 = 'closed' then $4::uuid end) returning id`,
    [TENANT, date, status, APP_USER]);
  return d.id;
}

/** The frozen day-Z an earlier close of [dayId] would have left behind. */
async function mkDayZ(dayId, number) {
  const { rows: [z] } = await c.query(
    `insert into public.z_reports (tenant_id, number, scope, trading_day_id, totals, closed_at, closed_by)
     values ($1, $2, 'day', $3, '{}'::jsonb, now(), $4) returning id`,
    [TENANT, number, dayId, APP_USER]);
  return z.id;
}

try {
  ({ rows: [{ id: APP_USER }] } = await c.query(
    `select id from public.app_users where tenant_id = $1 and role = 'owner' limit 1`, [TENANT]));

  // ── 1. STALE: closed day + newer OPEN day → must raise, never replay the Z ─
  await c.query("begin");
  await asOwner();
  {
    const stale = await mkDay("2030-01-01", "closed");
    await mkDayZ(stale, "ZPROBE-A");
    await mkDay("2030-01-02", "open");
    let err = null, got = null;
    try { ({ rows: [got] } = await c.query(`select * from public.close_day($1)`, [stale])); }
    catch (e) { err = e.message; }
    check("stale close (newer open day) raises",
      !!err && err.includes("newer day exists"), err ?? `NO ERROR — returned ${got?.number}`);
  }
  await c.query("rollback");

  // ── 2. STALE: closed day + newer day that is itself closed → still raises ──
  await c.query("begin");
  await asOwner();
  {
    const stale = await mkDay("2030-01-03", "closed");
    await mkDayZ(stale, "ZPROBE-B");
    await mkDay("2030-01-04", "closed");
    let err = null, got = null;
    try { ({ rows: [got] } = await c.query(`select * from public.close_day($1)`, [stale])); }
    catch (e) { err = e.message; }
    check("stale close (newer day already closed) raises",
      !!err && err.includes("newer day exists"), err ?? `NO ERROR — returned ${got?.number}`);
  }
  await c.query("rollback");

  // ── 3. RETRY: the LATEST closed day still replays its frozen Z ─────────────
  await c.query("begin");
  await asOwner();
  {
    const day = await mkDay("2030-01-05", "closed");
    const zId = await mkDayZ(day, "ZPROBE-C");
    try {
      const { rows: [z] } = await c.query(`select * from public.close_day($1)`, [day]);
      check("retry on the latest closed day replays its Z", z.id === zId, `returned ${z.number}`);
    } catch (e) {
      check("retry on the latest closed day replays its Z", false, e.message);
    }
  }
  await c.query("rollback");

  // ── 4. NORMAL: an open day with no open tills still closes ─────────────────
  await c.query("begin");
  await asOwner();
  {
    const day = await mkDay("2030-01-06", "open");
    try {
      const { rows: [z] } = await c.query(`select * from public.close_day($1)`, [day]);
      const { rows: [d] } = await c.query(`select status from public.trading_days where id = $1`, [day]);
      check("normal day close still cuts a fresh Z",
        z.scope === "day" && /^Z\d{6}$/.test(z.number) && d.status === "closed", `number=${z.number}`);
    } catch (e) {
      check("normal day close still cuts a fresh Z", false, e.message);
    }
  }
  await c.query("rollback");
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("harness error:", e.message);
  failed = true;
} finally {
  await c.end();
}
process.exitCode = failed ? 1 : 0;
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: all green (nothing persisted — every txn rolled back)");
