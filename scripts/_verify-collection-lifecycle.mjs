// Dry-run for 20260716000030_collection_lifecycle.sql against the LIVE DB,
// entirely inside one transaction that is ROLLED BACK — nothing persists.
//
// Proves, in order:
//   1. deliver_on_account + undo_on_account round-trip (job ready→delivered→ready,
//      invoice untouched throughout) — incl. the cashier GUC hatch if a cashier exists
//   2. record_payment full → auto-deliver → reverse_payment WALKS THE JOB BACK
//      (the restored regression) with the same-transaction-timestamp discriminator
//   3. a job delivered ON ACCOUNT, paid later, then reversed: job STAYS delivered
//      (the discriminator's negative case)
//   4. deliver_paid_job: prepaid bill + ready job → delivered; double-tap no-op
//   5. record_payment idempotency replay refuses a different invoice (restored guard)
//
//   node scripts/_verify-collection-lifecycle.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const __dirname = dirname(fileURLToPath(import.meta.url));
const mig = (f) => readFileSync(resolve(__dirname, "..", "supabase/migrations", f), "utf8");
const OWNER_AUTH_UID = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner)

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
let ok = true;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) ok = false;
};
const claims = (sub) =>
  c.query(`select set_config('request.jwt.claims', $1, true)`, [
    sub ? JSON.stringify({ sub, role: "authenticated" }) : "",
  ]);
const expectError = async (name, sql, params, needle) => {
  await c.query("savepoint exp");
  try {
    await c.query(sql, params);
    check(name, false, "no error was raised");
  } catch (e) {
    check(name, e.message.includes(needle), e.message.slice(0, 110));
  }
  await c.query("rollback to savepoint exp");
};
const jobRow = async (id) =>
  (await c.query(`select status, delivered_at from public.jobs where id=$1`, [id])).rows[0];
const docRow = async (id) =>
  (await c.query(`select status, amount_paid, total_incl from public.documents where id=$1`, [id])).rows[0];

try {
  await c.query("begin");
  await c.query(mig("20260716000020_deliver_on_account.sql")); // idempotent re-apply
  await c.query(mig("20260716000030_collection_lifecycle.sql"));
  await claims(OWNER_AUTH_UID);

  const cand = (await c.query(`
    select d.id inv, d.number, d.total_incl - d.amount_paid outstanding, d.job_id job
      from public.documents d join public.jobs j on j.id = d.job_id
     where d.doc_type='invoice' and d.status in ('issued','partly_paid')
       and d.customer_id is not null and j.status='ready' limit 1`)).rows[0];
  const invB = (await c.query(`
    select id, total_incl - amount_paid outstanding from public.documents
     where doc_type='invoice' and status in ('issued','partly_paid')
       and customer_id is not null and job_id is null limit 1`)).rows[0];
  if (!cand) { console.log("⚠ no READY-job candidate live right now — rerun when one exists"); process.exit(1); }
  console.log(`candidate: ${cand.number} (job ${cand.job.slice(0, 8)}…), no-job invoice B: ${invB?.id.slice(0, 8) ?? "none"}\n`);

  // ── 1. on-account handover + undo ────────────────────────────────────────
  console.log("— on-account round-trip —");
  await c.query(`select public.deliver_on_account($1)`, [cand.inv]);
  check("handover: job delivered", (await jobRow(cand.job)).status === "delivered");
  const undo1 = (await c.query(`select public.undo_on_account($1) u`, [cand.inv])).rows[0].u;
  const j1 = await jobRow(cand.job);
  check("undo: returns true", undo1 === true);
  check("undo: job back to ready, stamp cleared", j1.status === "ready" && j1.delivered_at === null);
  check("undo: invoice untouched", (await docRow(cand.inv)).status === "issued");
  check("undo twice: no-op false", (await c.query(`select public.undo_on_account($1) u`, [cand.inv])).rows[0].u === false);

  const cashier = (await c.query(`
    select auth_user_id from public.app_users
     where role='cashier' and is_active and auth_user_id is not null limit 1`)).rows[0];
  if (cashier) {
    await c.query(`select public.deliver_on_account($1)`, [cand.inv]);
    await claims(cashier.auth_user_id);
    const u = (await c.query(`select public.undo_on_account($1) u`, [cand.inv])).rows[0].u;
    check("CASHIER can undo via the guard hatch", u === true && (await jobRow(cand.job)).status === "ready");
    await claims(OWNER_AUTH_UID);
  } else console.log("  (no active cashier user — hatch tested implicitly via owner)");

  // ── 2. full payment auto-delivers; reversal walks the job back ───────────
  console.log("— reversal walk-back (regression repair) —");
  const pay1 = (await c.query(
    `select * from public.record_payment($1,'card',$2,null,'DRYRUN',null,null,'dryrun:a')`,
    [cand.inv, cand.outstanding])).rows[0];
  check("full card payment: invoice paid", (await docRow(cand.inv)).status === "paid");
  check("full card payment: job auto-delivered", (await jobRow(cand.job)).status === "delivered");
  await expectError("undo_on_account refuses a settled bill",
    `select public.undo_on_account($1)`, [cand.inv], "since been settled");
  await c.query(`select public.reverse_payment($1,'dry-run walk-back test',null)`, [pay1.id]);
  const j2 = await jobRow(cand.job);
  check("reversal: invoice back to issued", (await docRow(cand.inv)).status === "issued");
  check("reversal: job UN-DELIVERED (walk-back restored)", j2.status === "ready" && j2.delivered_at === null);

  // ── 3. on-account delivery survives a later payment's reversal ───────────
  console.log("— discriminator negative case —");
  await c.query(`select public.deliver_on_account($1)`, [cand.inv]);
  // Simulate the passage of time between handover and payment (all timestamps in
  // this tx share one now(), which would fool the discriminator's equality).
  await c.query(`update public.jobs set delivered_at = delivered_at - interval '1 hour' where id=$1`, [cand.job]);
  const pay2 = (await c.query(
    `select * from public.record_payment($1,'card',$2,null,'DRYRUN',null,null,'dryrun:b')`,
    [cand.inv, cand.outstanding])).rows[0];
  check("late settle: job still delivered (auto-deliver no-ops)", (await jobRow(cand.job)).status === "delivered");
  await c.query(`select public.reverse_payment($1,'dry-run case B',null)`, [pay2.id]);
  const j3 = await jobRow(cand.job);
  check("reversing the late payment does NOT resurrect the car", j3.status === "delivered",
    `status=${j3.status}`);
  check("…and the invoice is open again (receivable stands)", (await docRow(cand.inv)).status === "issued");

  // ── 4. prepaid pickup ─────────────────────────────────────────────────────
  console.log("— deliver_paid_job —");
  await claims(null); // service-role hat: rewind state past the guard for the setup
  await c.query(`update public.jobs set status='in_progress', delivered_at=null where id=$1`, [cand.job]);
  await claims(OWNER_AUTH_UID);
  await expectError("refuses while the bill is open",
    `select public.deliver_paid_job($1)`, [cand.job], "not settled");
  await c.query(
    `select public.record_payment($1,'card',$2,null,'DRYRUN',null,null,'dryrun:c')`,
    [cand.inv, cand.outstanding]);
  check("prepaid: paying an in_progress job does NOT deliver it", (await jobRow(cand.job)).status === "in_progress");
  await expectError("refuses a job that is not ready yet",
    `select public.deliver_paid_job($1)`, [cand.job], "not ready for collection");
  await c.query(`update public.jobs set status='ready' where id=$1`, [cand.job]); // legal move, any role
  const dp = (await c.query(`select public.deliver_paid_job($1) d`, [cand.job])).rows[0].d;
  check("ready + paid: delivered", dp === true && (await jobRow(cand.job)).status === "delivered");
  check("double tap: no-op false", (await c.query(`select public.deliver_paid_job($1) d`, [cand.job])).rows[0].d === false);
  // All rows in this tx share one created_at, so "latest" is ambiguous HERE (never
  // in prod, where each RPC call is its own transaction) — assert existence instead.
  const crumbs = (await c.query(
    `select payload->>'via' via, count(*) n from public.audit_events
      where ref_type='job' and ref_id=$1 and event_type='job_delivered'
      group by 1`, [cand.job])).rows;
  check("audit crumb 'collected (paid earlier)' written exactly once",
    crumbs.find((r) => r.via === "collected (paid earlier)")?.n === "1", JSON.stringify(crumbs));

  // ── 5. idempotency replay same-invoice guard ──────────────────────────────
  console.log("— record_payment replay guard —");
  if (invB) {
    await expectError("replaying a key against a DIFFERENT invoice is refused",
      `select * from public.record_payment($1,'card',$2,null,'DRYRUN',null,null,'dryrun:c')`,
      [invB.id, Math.min(Number(invB.outstanding), 1)], "different invoice");
  } else console.log("  (no jobless open invoice — cross-invoice replay untested)");
  const replay = (await c.query(
    `select * from public.record_payment($1,'card',$2,null,'DRYRUN',null,null,'dryrun:c')`,
    [cand.inv, cand.outstanding])).rows[0];
  check("replaying the key on the SAME invoice returns the original payment", replay.id != null);

  await c.query("rollback");
  console.log(`\n${ok ? "PASS" : "FAIL"} — transaction rolled back, nothing persisted.`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("✗ dry-run error:", e.message);
  process.exit(1);
} finally {
  await c.end();
}
