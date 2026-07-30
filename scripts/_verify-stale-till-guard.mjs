// Verifies 20260730000040_stale_till_guard.sql against the LIVE DB, everything
// inside BEGIN/ROLLBACK — no test row survives.
//
//   1. BLOCKED  — a sale rung on a till whose trading day is yesterday raises
//                 "this till is still on the day of …" (full issue_document path).
//   2. ALLOWED  — the helper stays silent for both real open sessions (their
//                 trading day IS today).
//   3. UNCHANGED— a normal sale through today's real session still issues fine.
//
// The 06:00 grace branch can't be exercised without shifting now(); it is one
// boolean in app.assert_till_day_current, reviewed by eye.
import { config } from "dotenv";
import pg from "pg";
config({ path: ".env" });

const TENANT = "11111111-1111-4111-8111-000000000001";
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh's AUTH uid — goes in JWT claims
let APP_USER; // an app_users.id for opened_by/created_by FKs — probed live below
const TODAY_SESSION = "f130cea5-65c4-45ec-9478-f0adcf13cc1d"; // TAB-66D2, trading day = today
const REPOINTED_SESSION = "8c152892-e610-4137-b6aa-d4f2d0bed105"; // TAB-84A1 after the data fix

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL.trim(), ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

// A draft invoice with one ad-hoc line, owned by a live customer. Only ever
// created inside an open transaction that this script rolls back.
async function mkDraft() {
  const { rows: [cust] } = await c.query(
    `select id from public.customers where tenant_id = $1 limit 1`, [TENANT]);
  const { rows: [doc] } = await c.query(
    `insert into public.documents (tenant_id, doc_type, status, customer_id, created_by, origin)
     values ($1, 'invoice', 'draft', $2, $3, 'standalone') returning id`, [TENANT, cust.id, APP_USER]);
  await c.query(
    `insert into public.document_lines (tenant_id, document_id, title, qty, unit_price, vat_rate, sort_order)
     values ($1, $2, 'guard-test line', 1, 100, 15, 1)`, [TENANT, doc.id]);
  return doc.id;
}
const asOwner = () =>
  c.query(`select set_config('request.jwt.claims', $1, true)`, // txn-local claims
    [JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" })]);

try {
  ({ rows: [{ id: APP_USER }] } = await c.query(
    `select id from public.app_users where tenant_id = $1 and role = 'owner' limit 1`, [TENANT]));
  // ── 1. stale till is BLOCKED end-to-end ──────────────────────────────────
  await c.query("begin");
  await asOwner();
  const { rows: absent } = await c.query(
    `select 1 from public.trading_days where tenant_id = $1 and business_date = '2026-07-26'`, [TENANT]);
  if (absent.length) throw new Error("2026-07-26 trading day unexpectedly exists — pick another date");
  const { rows: [day] } = await c.query(
    `insert into public.trading_days (tenant_id, business_date, status)
     values ($1, '2026-07-26', 'open') returning id`, [TENANT]);
  const { rows: [sess] } = await c.query(
    `insert into public.cash_sessions (tenant_id, device_id, opened_by, opening_float, status, trading_day_id, service_no)
     values ($1, 'TAB-TEST', $2, 0, 'open', $3, 1) returning id`, [TENANT, APP_USER, day.id]);
  const draft1 = await mkDraft();
  let blocked = null;
  try {
    await c.query(`select public.issue_document($1, null, null, $2)`, [draft1, sess.id]);
  } catch (e) {
    blocked = e.message;
  }
  await c.query("rollback");
  check("stale till blocked (issue_document, full path)",
    !!blocked && blocked.includes("still on the day of 2026-07-26"), blocked ?? "NO ERROR RAISED");

  // ── 2. helper stays silent for both REAL sessions (their day is today) ───
  await c.query("begin");
  const silent = async (id, label) => {
    try { await c.query(`select app.assert_till_day_current($1)`, [id]); return check(`helper silent for ${label}`, true); }
    catch (e) { return check(`helper silent for ${label}`, false, e.message); }
  };
  await silent(TODAY_SESSION, "TAB-66D2 (today's session)");
  await silent(REPOINTED_SESSION, "TAB-84A1 (re-pointed session)");
  await c.query("rollback");

  // ── 2b. payments path: filing money to a stale till is blocked too ───────
  await c.query("begin");
  {
    const { rows: [day] } = await c.query(
      `insert into public.trading_days (tenant_id, business_date, status)
       values ($1, '2026-07-26', 'open') returning id`, [TENANT]);
    const { rows: [sess] } = await c.query(
      `insert into public.cash_sessions (tenant_id, device_id, opened_by, opening_float, status, trading_day_id, service_no)
       values ($1, 'TAB-TEST', $2, 0, 'open', $3, 1) returning id`, [TENANT, APP_USER, day.id]);
    const { rows: [inv] } = await c.query(
      `select id from public.documents where tenant_id = $1 and doc_type = 'invoice' and status = 'paid' limit 1`, [TENANT]);
    let payBlocked = null;
    await c.query("savepoint sp_stale_pay");
    try {
      await c.query(
        `insert into public.payments (tenant_id, document_id, method, amount, tendered, change_given, received_by, cash_session_id, booked_session_id)
         values ($1, $2, 'cash', 1, 1, 0, $3, $4, $4)`, [TENANT, inv.id, APP_USER, sess.id]);
    } catch (e) { payBlocked = e.message; await c.query("rollback to savepoint sp_stale_pay"); }
    check("stale till blocked for payments (trigger path)",
      !!payBlocked && payBlocked.includes("still on the day of 2026-07-26"), payBlocked ?? "NO ERROR RAISED");
    let payOk = true, payErr = "";
    try {
      await c.query(
        `insert into public.payments (tenant_id, document_id, method, amount, tendered, change_given, received_by, cash_session_id, booked_session_id)
         values ($1, $2, 'cash', 1, 1, 0, $3, $4, $4)`, [TENANT, inv.id, APP_USER, TODAY_SESSION]);
    } catch (e) { payOk = false; payErr = e.message; }
    check("payment on today's till still accepted", payOk, payErr);
  }
  await c.query("rollback");

  // ── 3. a normal sale through today's real session still issues ───────────
  await c.query("begin");
  await asOwner();
  const draft2 = await mkDraft();
  try {
    const { rows: [r] } = await c.query(
      `select * from public.issue_document($1, null, null, $2)`, [draft2, TODAY_SESSION]);
    check("normal sale still issues on today's till", r.status === "issued" && r.business_day instanceof Date,
      `number=${r.number} business_day stamped`);
  } catch (e) {
    check("normal sale still issues on today's till", false, e.message);
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
