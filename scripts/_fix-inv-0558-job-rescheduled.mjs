// 2026-11-18: A00461 was signed for work on another day, with no deposit agreed. To take a
// Rs 500 deposit the staff pushed its job Start → Mark ready → Credit at the till, which issued
// INV-0558 and handed the car over on account. The on-account handover was already walked back
// (undo_on_account, 15:49), leaving the job READY for a car that has not arrived. Put it back
// to SCHEDULED for Mon 23 Nov 2026 09:00 (Mauritius) — owner's instruction. INV-0558 stays
// issued (fiscal lock) and keeps its place in TO COLLECT for the deposit.
//
// Dry run (rolled back) by default; pass --apply to commit. One transaction, as postgres
// (jobs_guard trusts a session with no auth.uid()), actor null on the audit row.
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";
requireEnv("SUPABASE_DB_URL", DB_URL);

const APPLY = process.argv.includes("--apply");
const TENANT = "11111111-1111-4111-8111-000000000001";
const JOB = "6341dcd8-671b-4084-badf-043118749b76";
const INVOICE = "417b40da-f6f9-44db-813e-e1df5215d166";
const SCHEDULED_FOR = "2026-11-23T09:00:00+04:00";
const REASON = "support fix 2026-11-18: job pushed to ready/on-account by mistake to take a deposit; car booked for Mon 23 Nov 09:00";

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
const show = async (label) => {
  const r = await c.query(
    `select j.status, j.scheduled_at, j.started_at, j.ready_at, j.delivered_at, j.completed_by, j.paused_ms,
            d.number, d.status as bill, d.amount_paid
       from jobs j join documents d on d.id = $2 where j.id = $1`,
    [JOB, INVOICE],
  );
  console.log(label);
  console.table(r.rows);
};
try {
  await c.query("begin");
  await show("BEFORE");

  const { rows: [job] } = await c.query(
    "select status, delivered_at from jobs where id = $1 and tenant_id = $2 for update", [JOB, TENANT]);
  if (!job) throw new Error("job not found");
  if (job.status !== "ready" || job.delivered_at !== null) throw new Error(`job is ${job.status} — expected ready, not delivered`);

  const { rows: [bill] } = await c.query(
    "select number, status, job_id from documents where id = $1 and tenant_id = $2", [INVOICE, TENANT]);
  if (bill?.number !== "INV-0558" || bill.job_id !== JOB) throw new Error("INV-0558 is not this job's bill");
  if (!["issued", "partly_paid"].includes(bill.status)) throw new Error(`INV-0558 is ${bill.status} — expected issued or partly_paid`);

  const { rows: [last] } = await c.query(
    "select event_type from audit_events where tenant_id = $1 and ref_type = 'job' and ref_id = $2 order by created_at desc limit 1",
    [TENANT, JOB]);
  if (last?.event_type !== "job_delivery_reversed") throw new Error(`last job event is ${last?.event_type} — expected the on-account undo`);

  const upd = await c.query(
    `update jobs
        set status = 'scheduled', scheduled_at = $2::timestamptz,
            started_at = null, ready_at = null, delivered_at = null, completed_by = null,
            paused_at = null, paused_ms = 0
      where id = $1 and status = 'ready'`,
    [JOB, SCHEDULED_FOR]);
  if (upd.rowCount !== 1) throw new Error(`expected 1 job updated, got ${upd.rowCount}`);

  await c.query(
    `insert into audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
     values ($1, null, 'job_status_corrected', 'job', $2, $3::jsonb)`,
    [TENANT, JOB, JSON.stringify({ from: "ready", to: "scheduled", scheduled_at: SCHEDULED_FOR, invoice: "INV-0558", reason: REASON })]);

  await show("AFTER");
  await c.query(APPLY ? "commit" : "rollback");
  console.log(APPLY ? "COMMITTED" : "DRY RUN — rolled back (pass --apply to commit)");
} catch (e) {
  await c.query("rollback");
  console.error("ROLLED BACK:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
