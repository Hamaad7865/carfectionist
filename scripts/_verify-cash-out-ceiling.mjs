// Verifies 20261012000030_restore_cash_out_ceiling.sql against the LIVE database, inside
// ONE BEGIN/ROLLBACK on the TEST Sandbox tenant (…0002). Nothing survives.
//
// The drawer it builds: Service 1 takes Rs 1,150 cash and closes. Service 2 opens on a
// Rs 2,000 float and refunds that sale in cash — Rs 850 is physically left.
//
//   BEFORE  a Rs 1,000 cash-out from Service 2 is APPROVED: the installed function sums
//           cash by the till that took the money, so the refund is invisible to it.
//   AFTER   the same cash-out is refused ('only 850.00 is in the drawer'), Rs 800 still
//           goes through, the function is character for character the body
//           20260716000060 defines, and a second run of the file is a no-op.
//
// Once the migration is really installed, BEFORE is skipped and AFTER still runs.
//
//   node scripts/_verify-cash-out-ceiling.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DB_URL, requireEnv } from "./_env.mjs";
import { SANDBOX_TENANT } from "./_sandbox.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const __dirname = dirname(fileURLToPath(import.meta.url));
const mig = (f) => readFileSync(resolve(__dirname, "..", "supabase/migrations", f), "utf8");
const MIGRATION = "20261012000030_restore_cash_out_ceiling.sql";
const SANDBOX_OWNER_AUTH = "b729191b-1159-4d46-88c7-3c9aceb5e664"; // TEST Sandbox (owner)

// The body the history says is installed: the newest file that defines the function.
const historyBody = (() => {
  const sql = mig("20260716000060_cancel_reprice_tillfix.sql").replace(/\r/g, "");
  const rest = sql.slice(sql.search(/create or replace function public\.record_till_cash_out/i));
  const tag = rest.match(/\bas\s+(\$[a-z_]*\$)/i);
  const open = tag.index + tag[0].length;
  return rest.slice(open, rest.indexOf(tag[1], open));
})();

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};
const claims = (sub) =>
  c.query(`select set_config('request.jwt.claims', $1, true)`, [sub ? JSON.stringify({ sub, role: "authenticated" }) : ""]);
const asOwner = () => claims(SANDBOX_OWNER_AUTH);
const asService = () => claims(null);
/** Run a statement in its own savepoint; hand back the error message, or null if it worked. */
const attempt = async (sql, params) => {
  await c.query("savepoint att");
  let msg = null;
  try { await c.query(sql, params); } catch (e) { msg = e.message; }
  await c.query("rollback to savepoint att");
  return msg;
};
const fn = async () => (await c.query(
  `select p.prosrc src, md5(pg_get_functiondef(p.oid)) md5, p.proacl::text acl
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_till_cash_out'`)).rows;
const closeTills = async () => {
  await asService();
  await c.query(`update public.cash_sessions set status = 'closed', closed_at = now() where tenant_id = $1 and status = 'open'`, [SANDBOX_TENANT]);
  await asOwner();
};
const cashOut = `select * from public.record_till_cash_out($1::uuid, $2::numeric, 'probe: petty cash', null)`;

const [before] = await fn();
try {
  await c.query("begin");
  await asOwner();
  const tenant = (await c.query(`select app.current_tenant_id() t`)).rows[0].t;
  if (tenant !== SANDBOX_TENANT) throw new Error(`refusing to run: the impersonated user belongs to ${tenant}, not the sandbox`);

  console.log("▸ fixtures (sandbox tenant, live RPCs)");
  await closeTills(); // the sandbox's forgotten tills — fixture setup, rolled back with the rest
  const stamp = Date.now();
  const one = (await c.query(`select id from public.open_cash_session($1, 0)`, [`SANDBOX-CO1-${stamp}`])).rows[0].id;
  const cust = (await c.query(
    `insert into public.customers (tenant_id, name) values ($1, 'ZZ Cash-out Probe') returning id`, [SANDBOX_TENANT])).rows[0].id;
  const draft = (await c.query(`select * from public.save_draft($1::jsonb, $2::jsonb, null)`, [
    JSON.stringify({ doc_type: "invoice", customer_id: cust }),
    JSON.stringify([{ product_id: null, title: "Cash-out probe", qty: 1, unit_price: 1000, discount_pct: 0, vat_rate: 15, sort_order: 0, line_kind: "product" }]),
  ])).rows[0];
  const inv = (await c.query(`select * from public.issue_document($1, null, $2, $3)`, [draft.id, `co-probe:issue:${stamp}`, one])).rows[0];
  const paid = (await c.query(
    `select * from public.record_payment($1::uuid, 'cash'::payment_method, $2::numeric, null, null, $3::uuid, null, $4)`,
    [inv.id, inv.total_incl, one, `co-probe:pay:${stamp}`])).rows[0];
  check("Service 1 took Rs 1,150 in cash", Number(paid.amount) === 1150 && paid.booked_session_id === one, paid.amount);

  await closeTills();
  const two = (await c.query(`select id from public.open_cash_session($1, 2000)`, [`SANDBOX-CO2-${stamp}`])).rows[0].id;
  const refund = (await c.query(`select * from public.reverse_payment($1::uuid, 'probe: refund', $2::uuid)`, [paid.id, two])).rows[0];
  check("Service 2 (Rs 2,000 float) paid the refund out of its own drawer",
    Number(refund.amount) === -1150 && refund.cash_session_id === one && refund.booked_session_id === two,
    `taken on ${refund.cash_session_id === one ? "Service 1" : "?"}, booked to ${refund.booked_session_id === two ? "Service 2" : "?"}`);
  console.log("  · Rs 2,000 − Rs 1,150 = Rs 850 is physically in the drawer");

  const installed = before.src.includes("from public.payments where booked_session_id = p_session_id and method = 'cash';");
  if (installed) {
    console.log("\n▸ BEFORE — skipped: the ceiling is already measured on the booked till");
  } else {
    console.log("\n▸ BEFORE — the fault is real");
    const b = await attempt(cashOut, [two, 1000]);
    check("a Rs 1,000 cash-out is APPROVED against a drawer holding Rs 850", b === null, b ?? "approved");
  }

  console.log(`\n▸ loading ${MIGRATION}`);
  await asService();
  await c.query(mig(MIGRATION));
  const [after] = await fn();
  check("the migration ran and its own proof block passed", true);
  check("the function is now character for character the body 20260716000060 defines", after.src === historyBody,
    after.src === historyBody ? "" : `${after.src.length} vs ${historyBody.length} chars`);
  check("the grants are untouched", after.acl === before.acl);
  await c.query(mig(MIGRATION));
  check("running the file a second time changes nothing", (await fn())[0].md5 === after.md5);
  await asOwner();

  console.log("\n▸ AFTER");
  const a = await attempt(cashOut, [two, 1000]);
  check("the Rs 1,000 cash-out is refused, and says what is really there", !!a && a.includes("only 850.00 is in the drawer"), a ?? "APPROVED");
  const ok = await attempt(cashOut, [two, 800]);
  check("a Rs 800 cash-out still goes through", ok === null, ok ?? "");
} catch (e) {
  failed = true;
  console.error(`\n✗ probe error: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  const [end] = await fn();
  check("ROLLED BACK — the installed function is byte-identical to how this run found it", end.md5 === before.md5, end.md5);
  await c.end();
}
console.log(`\n${failed ? "FAIL" : "PASS"} — nothing persisted.`);
process.exit(failed ? 1 : 0);
