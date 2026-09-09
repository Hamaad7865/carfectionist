// Verifies 20260909000040_the_final_float_is_the_whole_drawer.sql against the LIVE DB,
// entirely inside ONE BEGIN/ROLLBACK (migration loaded in the txn; nothing survives).
//
//   Final cash float must now read the COUNTED drawer (initial float + cash in it),
//   while the banking is left exactly as 20260905000010 set it:
//     • float_final (top-level Z totals)  == counted
//     • float_final (services[] block)    == counted
//     • float_out / remitted / banked     == UNCHANGED (float stays, takings bank)
//     • a SHORT drawer: float_final == counted (the real, short amount), no negatives
import { readFileSync } from "node:fs";
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const TENANT = "11111111-1111-4111-8111-000000000001";
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh's AUTH uid → JWT claims
const MIGRATION = "supabase/migrations/20260909000040_the_final_float_is_the_whole_drawer.sql";
const DEVICE = "TEST-FINAL-FLOAT";
const FLOAT = 2000;

const c = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed = true; };
const asOwner = () => c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" })]);
let APP_USER, DAY;

async function openTill() {
  const { rows: [s] } = await c.query(
    `insert into public.cash_sessions (tenant_id, device_id, opened_by, opening_float, status, trading_day_id, service_no)
     values ($1,$2,$3,$4,'open',$5,1) returning id`, [TENANT, DEVICE, APP_USER, FLOAT, DAY]);
  return s.id;
}
async function closeWith(sessionId, counted, remit) {
  const { rows: [z] } = await c.query(`select (public.close_service($1,$2,$3::text[],null)).*`, [sessionId, counted, remit]);
  const { rows: [m] } = await c.query(
    `select counted, remitted, float_out from public.cash_session_methods where cash_session_id=$1 and method='cash'`, [sessionId]);
  const { rows: [bank] } = await c.query(
    `select coalesce(sum(amount),0) as total from public.bank_remittances where cash_session_id=$1 and method='cash'`, [sessionId]);
  const svc = Array.isArray(z.totals.services) ? z.totals.services.find(s => String(s.service_no) === "1") : null;
  return { ...m, banked: Number(bank.total), float_final: Number(z.totals.float_final), svc_float_final: svc ? Number(svc.float_final) : null };
}

try {
  ({ rows: [{ id: APP_USER }] } = await c.query(`select id from public.app_users where tenant_id=$1 and role='owner' limit 1`, [TENANT]));
  await c.query("begin");
  await asOwner();
  const testDate = "2026-06-16";
  const { rows: clash } = await c.query(`select 1 from public.trading_days where tenant_id=$1 and business_date=$2`, [TENANT, testDate]);
  if (clash.length) throw new Error(`${testDate} trading day already exists — pick another date`);
  ({ rows: [{ id: DAY }] } = await c.query(
    `insert into public.trading_days (tenant_id, business_date, status) values ($1,$2,'open') returning id`, [TENANT, testDate]));

  await c.query(readFileSync(MIGRATION, "utf8"));       // apply the fix inside the txn
  await c.query("savepoint s1");

  // NORMAL — counted 3100 over a 2000 float: bank 1100, keep 2000, but Final float = 3100
  const n = await closeWith(await openTill(), 3100, ["cash"]);
  check("Final float = the whole drawer counted (top-level)", n.float_final === 3100, `float_final ${n.float_final}`);
  check("Final float = the whole drawer counted (services[] block)", n.svc_float_final === 3100, `svc float_final ${n.svc_float_final}`);
  check("banking UNCHANGED: float stays 2000, takings 1100 bank",
    Number(n.float_out) === FLOAT && Number(n.remitted) === 1100 && Number(n.banked) === 1100,
    `float_out ${n.float_out}, remitted ${n.remitted}, banked ${n.banked}`);
  await c.query("rollback to savepoint s1");

  // SHORT — counted 1500 under a 2000 float: Final float = 1500 (what is really there)
  const s = await closeWith(await openTill(), 1500, ["cash"]);
  check("short drawer: Final float = counted 1500, nothing banked, no negative",
    s.float_final === 1500 && Number(s.remitted) === 0 && Number(s.float_out) === 1500 && Number(s.banked) === 0,
    `float_final ${s.float_final}, remitted ${s.remitted}, float_out ${s.float_out}`);
} catch (err) {
  failed = true;
  console.error("✗ threw:", err.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failed ? "\nFAILED" : "\nAll checks passed.");
process.exitCode = failed ? 1 : 0;
