// Verifies 20260814000010_back_office_till_rolls_forward.sql against the LIVE DB,
// everything inside ONE BEGIN/ROLLBACK — the migration itself is loaded inside the
// txn, so neither the new functions nor any test row survive.
//
//   A. REPRODUCE — issuing a back-office sale on a stale session raises the
//                  stale-till guard ("still on the day of …"). This is the bug.
//   B. PREDICATE — app.till_day_is_stale: true for the stale session, false for
//                  a session on today's day.
//   C. THE FIX  — back_office_till() rolls the stale session forward: it returns
//                  a session on TODAY, the stale session is now closed at variance
//                  0, and a real invoice issues on the returned session.
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import pg from "pg";
config({ path: ".env" });

const TENANT = "11111111-1111-4111-8111-000000000001";
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh's AUTH uid — goes in JWT claims
const MIGRATION = "supabase/migrations/20260814000010_back_office_till_rolls_forward.sql";
let APP_USER;

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL.trim(), ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};
const asOwner = () =>
  c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" })]);

async function mkDraft() {
  const { rows: [cust] } = await c.query(`select id from public.customers where tenant_id = $1 limit 1`, [TENANT]);
  const { rows: [doc] } = await c.query(
    `insert into public.documents (tenant_id, doc_type, status, customer_id, created_by, origin)
     values ($1, 'invoice', 'draft', $2, $3, 'standalone') returning id`, [TENANT, cust.id, APP_USER]);
  await c.query(
    `insert into public.document_lines (tenant_id, document_id, title, qty, unit_price, vat_rate, sort_order)
     values ($1, $2, 'roll-test line', 1, 100, 15, 1)`, [TENANT, doc.id]);
  return doc.id;
}

try {
  ({ rows: [{ id: APP_USER }] } = await c.query(
    `select id from public.app_users where tenant_id = $1 and role = 'owner' limit 1`, [TENANT]));

  await c.query("begin");
  await asOwner();

  // Load the migration under test INSIDE the txn — rollback un-defines it.
  await c.query(readFileSync(MIGRATION, "utf8"));

  // A stale day + an open back-office session on it (the drifted desk till).
  const staleDate = "2026-07-26";
  const { rows: absent } = await c.query(
    `select 1 from public.trading_days where tenant_id = $1 and business_date = $2`, [TENANT, staleDate]);
  if (absent.length) throw new Error(`${staleDate} trading day unexpectedly exists — pick another date`);
  const { rows: [day] } = await c.query(
    `insert into public.trading_days (tenant_id, business_date, status)
     values ($1, $2, 'open') returning id`, [TENANT, staleDate]);
  // Any pre-existing open back-office session for this tenant would break the
  // one-open-per-device rule; retire it so the stale one below is the only one.
  await c.query(
    `update public.cash_sessions set status = 'closed', closed_at = now()
      where tenant_id = $1 and device_id = 'back-office' and status = 'open'`, [TENANT]);
  const { rows: [stale] } = await c.query(
    `insert into public.cash_sessions (tenant_id, device_id, opened_by, opening_float, status, trading_day_id, service_no)
     values ($1, 'back-office', $2, 0, 'open', $3, 1) returning id`, [TENANT, APP_USER, day.id]);

  // ── A. reproduce: issuing on the stale desk session is blocked ───────────
  const draftA = await mkDraft();
  let blocked = null;
  await c.query("savepoint sp_a");
  try {
    await c.query(`select public.issue_document($1, null, null, $2)`, [draftA, stale.id]);
  } catch (e) { blocked = e.message; await c.query("rollback to savepoint sp_a"); }
  check("stale desk session is blocked (the bug)",
    !!blocked && blocked.includes(`still on the day of ${staleDate}`), blocked ?? "NO ERROR RAISED");

  // ── B. predicate: stale is stale, today is not ───────────────────────────
  {
    const { rows: [{ stale: isStale }] } = await c.query(
      `select app.till_day_is_stale($1) as stale`, [stale.id]);
    check("till_day_is_stale = true for the stale session", isStale === true, `got ${isStale}`);
  }

  // ── C. the fix: back_office_till() rolls it forward ──────────────────────
  const { rows: [rolled] } = await c.query(`select * from public.back_office_till()`);
  const { rows: [{ business_date: rolledDate }] } = await c.query(
    `select td.business_date from public.cash_sessions cs
       join public.trading_days td on td.id = cs.trading_day_id where cs.id = $1`, [rolled.id]);
  const { rows: [{ mu_today }] } = await c.query(`select app.mu_today() as mu_today`);
  const sameDay = new Date(rolledDate).toISOString().slice(0, 10) === new Date(mu_today).toISOString().slice(0, 10);
  check("back_office_till returns a session on TODAY", sameDay,
    `rolled day=${new Date(rolledDate).toISOString().slice(0, 10)} today=${new Date(mu_today).toISOString().slice(0, 10)}`);
  check("a fresh session was minted (not the stale one)", rolled.id !== stale.id, `rolled=${rolled.id}`);
  check("predicate is now false for the rolled session",
    (await c.query(`select app.till_day_is_stale($1) as s`, [rolled.id])).rows[0].s === false);

  // the stale session was closed at book value (variance 0, nothing lost)
  {
    const { rows: [old] } = await c.query(
      `select status, variance from public.cash_sessions where id = $1`, [stale.id]);
    check("stale session is now closed at variance 0",
      old.status === "closed" && Number(old.variance) === 0, `status=${old.status} variance=${old.variance}`);
  }

  // and a real invoice issues on the rolled session
  {
    const draftC = await mkDraft();
    let issued = null, err = "";
    try {
      const { rows: [r] } = await c.query(
        `select status, number from public.issue_document($1, null, null, $2)`, [draftC, rolled.id]);
      issued = r;
    } catch (e) { err = e.message; }
    check("back-office invoice now issues cleanly", issued?.status === "issued",
      issued ? `number=${issued.number}` : err);
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
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: all green (nothing persisted — the txn rolled back)");
