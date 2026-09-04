// Verifies 20260905000010_the_float_stays_in_the_drawer.sql against the LIVE DB,
// everything inside ONE BEGIN/ROLLBACK — the migration is loaded inside the txn, so
// neither the changed function nor any test row survives.
//
//   A. REPRODUCE — with the DEPLOYED close_service, ticking CASH banks the whole
//                  counted drawer: float_out = 0.00, which is the 0.00 the owner
//                  reads as "Final cash float" on every Z.
//   B. THE FIX   — the float stays: float_out = opening_float, remitted = the rest.
//   C. SHORT     — a drawer counted BELOW the float remits nothing and keeps what
//                  is there; no negative remittance.
//   D. UNTICKED  — leaving CASH unticked is unchanged: nothing banked, the whole
//                  count carried on.
//   E. THE Z     — the frozen totals carry the corrected figure as `float_final`.
import { readFileSync } from "node:fs";
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const TENANT = "11111111-1111-4111-8111-000000000001";
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh's AUTH uid — goes in JWT claims
const MIGRATION = "supabase/migrations/20260905000010_the_float_stays_in_the_drawer.sql";
const DEVICE = "TEST-FLOAT-DRAWER";
const FLOAT = 2000;

const c = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};
const asOwner = () =>
  c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" })]);

let APP_USER, DAY;

/** A fresh open till on the test device, with a standing float. */
async function openTill() {
  const { rows: [s] } = await c.query(
    `insert into public.cash_sessions (tenant_id, device_id, opened_by, opening_float, status, trading_day_id, service_no)
     values ($1, $2, $3, $4, 'open', $5, 1) returning id`, [TENANT, DEVICE, APP_USER, FLOAT, DAY]);
  return s.id;
}

/** Close it and hand back the cash row + the Z's frozen float_final. */
async function closeWith(sessionId, counted, remit) {
  const { rows: [z] } = await c.query(
    `select (public.close_service($1, $2, $3::text[], null)).*`, [sessionId, counted, remit]);
  const { rows: [m] } = await c.query(
    `select counted, remitted, float_out from public.cash_session_methods
      where cash_session_id = $1 and method = 'cash'`, [sessionId]);
  const { rows: [bank] } = await c.query(
    `select coalesce(sum(amount), 0) as total from public.bank_remittances
      where cash_session_id = $1 and method = 'cash'`, [sessionId]);
  return { ...m, banked: Number(bank.total), float_final: z.totals.float_final };
}

try {
  ({ rows: [{ id: APP_USER }] } = await c.query(
    `select id from public.app_users where tenant_id = $1 and role = 'owner' limit 1`, [TENANT]));

  await c.query("begin");
  await asOwner();

  // A synthetic trading day of its own, so nothing here lands on a real day's books.
  const testDate = "2026-06-15";
  const { rows: clash } = await c.query(
    `select 1 from public.trading_days where tenant_id = $1 and business_date = $2`, [TENANT, testDate]);
  if (clash.length) throw new Error(`${testDate} trading day already exists — pick another date`);
  ({ rows: [{ id: DAY }] } = await c.query(
    `insert into public.trading_days (tenant_id, business_date, status)
     values ($1, $2, 'open') returning id`, [TENANT, testDate]));

  await c.query("savepoint s0");

  // ── A. REPRODUCE, against the function as deployed ────────────────────────
  const a = await closeWith(await openTill(), 2500, ["cash"]);
  check("A. deployed close_service sweeps the float to the bank",
    Number(a.float_out) === 0 && Number(a.banked) === 2500,
    `float_out ${a.float_out}, banked ${a.banked}, Z float_final ${a.float_final}`);

  await c.query("rollback to savepoint s0");

  // Load the fix INSIDE the txn — and take the savepoint AFTER it, or rolling back
  // between cases would un-define the very function under test (DDL is transactional).
  await c.query(readFileSync(MIGRATION, "utf8"));
  await c.query("savepoint s1");

  // ── B. THE FIX — counted 2500 over a 2000 float: bank 500, keep 2000 ──────
  const b = await closeWith(await openTill(), 2500, ["cash"]);
  check("B. the float stays in the drawer, the takings go to the bank",
    Number(b.float_out) === FLOAT && Number(b.remitted) === 500 && Number(b.banked) === 500,
    `float_out ${b.float_out}, remitted ${b.remitted}, banked ${b.banked}`);
  check("E. the Z freezes the corrected figure as float_final",
    Number(b.float_final) === FLOAT, `float_final ${b.float_final}`);

  await c.query("rollback to savepoint s1");

  // ── C. SHORT DRAWER — counted 1500 under a 2000 float ─────────────────────
  const cShort = await closeWith(await openTill(), 1500, ["cash"]);
  check("C. a short drawer remits nothing and keeps what is there",
    Number(cShort.remitted) === 0 && Number(cShort.float_out) === 1500 && Number(cShort.banked) === 0,
    `remitted ${cShort.remitted}, float_out ${cShort.float_out}`);

  await c.query("rollback to savepoint s1");

  // ── D. UNTICKED — unchanged behaviour ─────────────────────────────────────
  const d = await closeWith(await openTill(), 2500, []);
  check("D. leaving CASH unticked still carries the whole count on",
    Number(d.remitted) === 0 && Number(d.float_out) === 2500 && Number(d.banked) === 0,
    `remitted ${d.remitted}, float_out ${d.float_out}`);
} catch (err) {
  failed = true;
  console.error("✗ threw:", err.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failed ? "\nFAILED" : "\nAll checks passed.");
process.exitCode = failed ? 1 : 0;
