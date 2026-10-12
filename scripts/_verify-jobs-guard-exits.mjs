// Verifies 20261012000020_restore_jobs_guard_exits.sql against the LIVE database, inside
// ONE BEGIN/ROLLBACK on the TEST Sandbox tenant (…0002). Nothing survives.
//
// It REPRODUCES both faults on the guard that is installed right now, then loads the fix
// and repeats the very same call on the very same rows:
//
//   BEFORE  A. cancel_job on a job marked ready by mistake is stopped by its own trigger
//              ('illegal job transition: ready -> cancelled').
//           B. a CASHIER cannot undo a mistaken "put it on account" handover
//              ('only owner or manager can un-deliver a job') — undo_on_account opens a
//              hatch the installed guard no longer looks at.
//   AFTER   A. the ready job cancels, and its unpaid bill is voided with it.
//           B. the cashier's undo returns the car to READY — through the RPC only: the
//              same cashier still cannot un-deliver a job by hand.
//           C. delivered stays a one-way door for cancelling, the guard is character for
//              character the body 20260803000030 defines, and a second run is a no-op.
//
// Once the migration is really installed, BEFORE is skipped and AFTER still runs.
//
//   node scripts/_verify-jobs-guard-exits.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DB_URL, requireEnv } from "./_env.mjs";
import { SANDBOX_TENANT } from "./_sandbox.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const __dirname = dirname(fileURLToPath(import.meta.url));
const mig = (f) => readFileSync(resolve(__dirname, "..", "supabase/migrations", f), "utf8");
const MIGRATION = "20261012000020_restore_jobs_guard_exits.sql";
const SANDBOX_OWNER_AUTH = "b729191b-1159-4d46-88c7-3c9aceb5e664"; // TEST Sandbox (owner)

// The body the history says is installed: the newest file that defines the guard.
const historyBody = (() => {
  const sql = mig("20260803000030_a_ready_job_can_still_be_cancelled.sql").replace(/\r/g, "");
  const at = sql.indexOf("CREATE OR REPLACE FUNCTION app.jobs_guard()");
  const open = sql.indexOf("$function$", at) + "$function$".length;
  return sql.slice(open, sql.indexOf("$function$", open));
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
const attempt = async (sql, params, keep = false) => {
  await c.query("savepoint att");
  try {
    await c.query(sql, params);
    if (!keep) await c.query("rollback to savepoint att");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint att");
    return e.message;
  }
};
const guard = async () => (await c.query(
  `select p.prosrc src, md5(pg_get_functiondef(p.oid)) md5
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'jobs_guard'`)).rows;
const job = async (id) => (await c.query(`select status::text, delivered_at, cancel_reason from public.jobs where id = $1`, [id])).rows[0];
const doc = async (id) => (await c.query(`select status::text from public.documents where id = $1`, [id])).rows[0];

let seq = 0;
/** One car: a quote, its job marked READY, and its bill issued and unpaid. */
async function readyJobWithBill(label) {
  const cust = (await c.query(
    `insert into public.customers (tenant_id, name, phone) values ($1, $2, $3) returning id`,
    [SANDBOX_TENANT, `ZZ Guard Probe ${label}`, `5798${String(++seq).padStart(4, "0")}`])).rows[0].id;
  const car = (await c.query(
    `insert into public.vehicles (tenant_id, customer_id, plate, make) values ($1, $2, $3, 'Probe') returning id`,
    [SANDBOX_TENANT, cust, `ZZ JG ${seq}`])).rows[0].id;
  const quote = (await c.query(`select * from public.save_draft($1::jsonb, $2::jsonb, null)`, [
    JSON.stringify({ doc_type: "quote", customer_id: cust }),
    JSON.stringify([{ title: `Detail ${label}`, qty: 1, unit_price: 1000, vat_rate: 15, sort_order: 0, line_kind: "service", vehicle_id: car }]),
  ])).rows[0];
  await c.query(`select * from public.convert_quote_to_jobs($1, null, null, null)`, [quote.id]);
  const jobId = (await c.query(`select id from public.jobs where source_quote_id = $1`, [quote.id])).rows[0].id;
  await c.query(`update public.jobs set status = 'ready', ready_at = now() where id = $1`, [jobId]);
  const draft = (await c.query(`select * from public.convert_quote_to_invoice($1)`, [quote.id])).rows[0];
  const invoice = (await c.query(`select * from public.issue_document($1, null, $2, null)`, [draft.id, `jg-probe:issue:${draft.id}`])).rows[0];
  return { jobId, invoiceId: invoice.id };
}
/** The owner's own row, demoted for as long as the enclosing savepoint lives. */
const becomeCashier = async () => {
  await asService();
  await c.query(`update public.app_users set role = 'cashier' where tenant_id = $1 and auth_user_id = $2`, [SANDBOX_TENANT, SANDBOX_OWNER_AUTH]);
  await asOwner();
  return (await c.query(`select app.current_user_role()::text r`)).rows[0].r;
};

const [before] = await guard();
try {
  await c.query("begin");
  await asOwner();
  const tenant = (await c.query(`select app.current_tenant_id() t`)).rows[0].t;
  if (tenant !== SANDBOX_TENANT) throw new Error(`refusing to run: the impersonated user belongs to ${tenant}, not the sandbox`);

  console.log("▸ fixtures (sandbox tenant, live RPCs)");
  const mistake = await readyJobWithBill("marked ready by mistake");
  check("a job is 'ready' with an issued, unpaid bill", (await job(mistake.jobId)).status === "ready" && (await doc(mistake.invoiceId)).status === "issued");
  const account = await readyJobWithBill("on account");
  await c.query(`select public.deliver_on_account($1)`, [account.invoiceId]);
  check("a second car has been handed over on account", (await job(account.jobId)).status === "delivered");

  const installed = before.src.includes("app.allow_undeliver") && before.src.includes("('delivered','cancelled')");
  if (installed) {
    console.log("\n▸ BEFORE — skipped: the guard already has both exits, there is nothing left to reproduce");
  } else {
    console.log("\n▸ BEFORE — the faults are real");
    const a = await attempt(`select public.cancel_job($1, 'marked ready by mistake', true, null)`, [mistake.jobId]);
    check("A. cancel_job on the ready job is stopped by the guard", !!a && a.includes("illegal job transition: ready -> cancelled"), a ?? "IT WORKED");
    await c.query("savepoint cashier");
    const role = await becomeCashier();
    const b = await attempt(`select public.undo_on_account($1)`, [account.invoiceId]);
    check(`B. a ${role}'s undo of the on-account handover is refused`, role === "cashier" && !!b && b.includes("only owner or manager can un-deliver a job"), b ?? "IT WORKED");
    await c.query("rollback to savepoint cashier");
    await asOwner();
  }

  console.log(`\n▸ loading ${MIGRATION}`);
  await asService();
  await c.query(mig(MIGRATION));
  const [after] = await guard();
  check("the migration ran and its own proof block passed", true);
  check("the guard is now character for character the body 20260803000030 defines", after.src === historyBody,
    after.src === historyBody ? "" : `${after.src.length} vs ${historyBody.length} chars`);
  await c.query(mig(MIGRATION));
  check("running the file a second time changes nothing", (await guard())[0].md5 === after.md5);
  await asOwner();

  console.log("\n▸ AFTER — A. a ready job can be cancelled");
  const a2 = await attempt(`select public.cancel_job($1, 'marked ready by mistake', true, null)`, [mistake.jobId], true);
  check("cancel_job goes through", a2 === null, a2 ?? "");
  const cancelled = await job(mistake.jobId);
  check("the job is cancelled and keeps the reason", cancelled.status === "cancelled" && cancelled.cancel_reason === "marked ready by mistake", cancelled.status);
  check("its unpaid bill is voided with it", (await doc(mistake.invoiceId)).status === "void");

  console.log("\n▸ AFTER — B. the cashier's undo");
  await c.query("savepoint cashier");
  const role2 = await becomeCashier();
  const byHand = await attempt(`update public.jobs set status = 'ready', delivered_at = null where id = $1`, [account.jobId]);
  check(`a ${role2} still cannot un-deliver a job by hand`, !!byHand && byHand.includes("only owner or manager can un-deliver a job"), byHand ?? "IT WORKED");
  const b2 = await attempt(`select public.undo_on_account($1)`, [account.invoiceId], true);
  const undone = await job(account.jobId);
  check("…but undo_on_account returns the car to READY", b2 === null && undone.status === "ready" && undone.delivered_at === null, b2 ?? `job ${undone.status}`);
  check("…and the bill is untouched", (await doc(account.invoiceId)).status === "issued");
  await c.query("rollback to savepoint cashier");
  await asOwner();

  console.log("\n▸ AFTER — C. what must not have loosened");
  const gone = await attempt(`update public.jobs set status = 'cancelled' where id = $1`, [account.jobId]);
  check("delivered → cancelled is still an illegal transition", !!gone && gone.includes("illegal job transition: delivered -> cancelled"), gone ?? "IT WORKED");
  const back = await attempt(`update public.jobs set status = 'ready', delivered_at = null where id = $1`, [account.jobId]);
  check("the owner can still un-deliver directly", back === null, back ?? "");
} catch (e) {
  failed = true;
  console.error(`\n✗ probe error: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  const [end] = await guard();
  check("ROLLED BACK — the installed guard is byte-identical to how this run found it", end.md5 === before.md5, end.md5);
  await c.end();
}
console.log(`\n${failed ? "FAIL" : "PASS"} — nothing persisted.`);
process.exit(failed ? 1 : 0);
