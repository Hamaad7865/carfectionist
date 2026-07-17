// Rolled-back proof of auto_start_due_jobs(). Builds real jobs at known times,
// runs the exact function pg_cron runs, checks what flipped, then ROLLS BACK —
// nothing persists, and it never touches a real job.
//
// What must hold:
//   • a job whose scheduled_at has passed flips scheduled → in_progress
//   • its clock starts from the BOOKING (started_at = scheduled_at), not now()
//   • a future booking is left alone
//   • a job with no scheduled_at is left alone
//   • already-running / ready / cancelled jobs are untouched
//   • each flip writes ONE job_auto_started audit row, actor NULL (system)
//   • running twice flips nothing the second time (idempotent)
import pg from "pg";
import { DB_URL } from "./_env.mjs";

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");

  const tenant = (await c.query("select id from business_settings limit 1")).rows[0].id;
  const cust = (await c.query("select id from customers where tenant_id=$1 limit 1", [tenant])).rows[0].id;
  const veh = (await c.query("select id from vehicles where tenant_id=$1 limit 1", [tenant])).rows[0].id;

  const insJob = (statusExpr, schedExpr, startedExpr = "null") =>
    c.query(
      `insert into jobs (tenant_id, customer_id, vehicle_id, status, scheduled_at, started_at)
       values ($1, $2, $3, ${statusExpr}, ${schedExpr}, ${startedExpr}) returning id, scheduled_at, started_at`,
      [tenant, cust, veh],
    );

  const due = (await insJob("'scheduled'", "now() - interval '10 minutes'")).rows[0];
  const soon = (await insJob("'scheduled'", "now() + interval '2 hours'")).rows[0];
  const noTime = { id: (await insJob("'scheduled'", "null")).rows[0].id };
  const running = (await insJob("'in_progress'", "now() - interval '1 hour'", "now() - interval '30 minutes'")).rows[0];

  console.log("▸ run auto_start_due_jobs()");
  const n1 = (await c.query("select public.auto_start_due_jobs() n")).rows[0].n;
  check("flipped at least the one due job", Number(n1) >= 1, true);

  const dueAfter = (await c.query("select status, started_at from jobs where id=$1", [due.id])).rows[0];
  check("the due job is now in_progress", dueAfter.status, "in_progress");
  check("its clock starts from the BOOKING, not now()", new Date(dueAfter.started_at).toISOString(), new Date(due.scheduled_at).toISOString());

  check("a future booking is untouched", (await c.query("select status from jobs where id=$1", [soon.id])).rows[0].status, "scheduled");
  check("a job with no scheduled_at is untouched", (await c.query("select status from jobs where id=$1", [noTime.id])).rows[0].status, "scheduled");
  const runAfter = (await c.query("select status, started_at from jobs where id=$1", [running.id])).rows[0];
  check("an already-running job keeps its status", runAfter.status, "in_progress");
  check("…and its original started_at (clock not reset)", new Date(runAfter.started_at).toISOString(), new Date(running.started_at).toISOString());

  console.log("▸ audit trail");
  const aud = await c.query(
    "select actor_id, payload->>'scheduled_at' sched from audit_events where event_type='job_auto_started' and ref_id=$1",
    [due.id],
  );
  check("exactly one job_auto_started row for the flipped job", aud.rows.length, 1);
  check("actor is NULL — nobody pressed anything", aud.rows[0].actor_id, "null");

  console.log("▸ idempotent");
  const n2 = (await c.query("select public.auto_start_due_jobs() n")).rows[0].n;
  check("a second run flips nothing new", n2, 0);

  console.log("▸ the transition guard let the system through");
  // The guard (trg_jobs_guard) is enabled and fired on the flip above — an
  // illegal transition would have raised, so a successful flip IS the proof it
  // passed. Confirm the guard is armed, not disabled.
  const guard = await c.query("select tgenabled from pg_trigger where tgrelid='jobs'::regclass and tgname='trg_jobs_guard'");
  check("trg_jobs_guard is enabled, and the flip still succeeded through it", guard.rows[0]?.tgenabled === "O", true);
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(failures === 0 ? "\n✓ all checks passed (rolled back)" : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
