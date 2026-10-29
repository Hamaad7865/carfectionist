// Dry-run for 20261029000010_a_paid_job_can_be_handed_back_unfinished.sql against the
// LIVE DB, entirely inside one transaction that is ROLLED BACK — nothing persists.
//
// The fixture is a real delivered job whose bill is paid in full, rewound (as the
// service role, inside the transaction) to the state JOB-49B3 was stranded in on
// 27 Oct 2026: paid at the counter, never marked ready, timer paused.
//
// Proves, in order:
//   1. deliver_paid_job STILL refuses the in-progress job (the prepaid invariant
//      _verify-collection-lifecycle.mjs holds is not loosened)
//   2. hand_back_paid_job: in progress + paid → delivered in one call; ready_at and
//      delivered_at stamped, the open pause folded, completed_by = the caller,
//      the prepaid-pickup audit crumb written once, and NO new bill raised
//   3. double tap → false, nothing moves
//   4. a READY paid job → delivered too (same button whichever step it is at)
//   5. refusals: a scheduled job; a job with no bill — and the refused call leaves
//      the job exactly where it was
//   6. no tenant context → refused; anon holds no EXECUTE
//
//   node scripts/_verify-hand-back-paid-job.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const __dirname = dirname(fileURLToPath(import.meta.url));
const mig = (f) => readFileSync(resolve(__dirname, "..", "supabase/migrations", f), "utf8");

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
  (await c.query(
    `select status, ready_at, delivered_at, paused_at, paused_ms, completed_by from public.jobs where id=$1`,
    [id],
  )).rows[0];
const billCount = async (jobId) =>
  Number((await c.query(
    `select count(*) n from public.documents where doc_type='invoice' and job_id=$1`, [jobId],
  )).rows[0].n);
// Service role (no claims): jobs_guard trusts it, so the fixture can be rewound.
const rewind = async (jobId, status, extra = "") => {
  await claims(null);
  await c.query(
    `update public.jobs set status=$2, ready_at=${status === "ready" ? "now()" : "null"},
            delivered_at=null, completed_by=null ${extra} where id=$1`,
    [jobId, status],
  );
};

try {
  await c.query("begin");
  await c.query(mig("20261029000010_a_paid_job_can_be_handed_back_unfinished.sql"));

  // A delivered job whose every live bill is paid (job_id link), in a tenant with an
  // active manager or owner to act as.
  const fx = (await c.query(`
    select j.id job, j.tenant_id, d.number,
           (select u.auth_user_id from public.app_users u
             where u.tenant_id = j.tenant_id and u.is_active and u.auth_user_id is not null
               and u.role in ('manager','owner') order by u.role desc limit 1) actor,
           (select u.id from public.app_users u
             where u.tenant_id = j.tenant_id and u.is_active and u.auth_user_id is not null
               and u.role in ('manager','owner') order by u.role desc limit 1) actor_app_id
      from public.jobs j join public.documents d on d.job_id = j.id and d.doc_type='invoice' and d.status='paid'
     where j.status = 'delivered'
       and not exists (select 1 from public.documents o where o.job_id = j.id and o.doc_type='invoice'
                        and o.status in ('issued','partly_paid'))
     order by j.delivered_at desc limit 1`)).rows[0];
  if (!fx?.actor) { console.log("⚠ no delivered+paid job with an actor — nothing to rewind"); process.exit(1); }
  const bills0 = await billCount(fx.job);
  console.log(`fixture: job ${fx.job.slice(0, 8)}… on ${fx.number}, acting as app user ${fx.actor_app_id.slice(0, 8)}…\n`);

  // ── 1. the prepaid invariant holds ───────────────────────────────────────────
  console.log("— deliver_paid_job unchanged —");
  await rewind(fx.job, "in_progress", ", paused_at = now() - interval '5 minutes', paused_ms = 0");
  await claims(fx.actor);
  await expectError("deliver_paid_job refuses an in-progress job",
    `select public.deliver_paid_job($1)`, [fx.job], "not ready for collection");

  // ── 2. in progress + paid → delivered in one call ────────────────────────────
  console.log("— hand_back_paid_job from in progress —");
  const crumbCount = async () => Number((await c.query(
    `select count(*) n from public.audit_events
      where ref_id=$1 and event_type='job_delivered' and payload->>'via' = 'collected (paid earlier)'`,
    [fx.job])).rows[0].n);
  const crumbs0 = await crumbCount();
  const moved = (await c.query(`select public.hand_back_paid_job($1) r`, [fx.job])).rows[0].r;
  const j2 = await jobRow(fx.job);
  check("returns true", moved === true);
  check("job delivered", j2.status === "delivered", j2.status);
  check("ready_at and delivered_at stamped", j2.ready_at !== null && j2.delivered_at !== null);
  check("open pause folded (≥ 5 min) and cleared",
    j2.paused_at === null && Number(j2.paused_ms) >= 300000, `paused_ms=${j2.paused_ms}`);
  check("completed_by = the caller", j2.completed_by === fx.actor_app_id, j2.completed_by);
  const crumbs1 = await crumbCount();
  check("one prepaid-pickup audit crumb added", crumbs1 === crumbs0 + 1, `${crumbs0} → ${crumbs1}`);
  check("no new bill raised", (await billCount(fx.job)) === bills0, `${bills0} → ${await billCount(fx.job)}`);

  // ── 3. double tap ───────────────────────────────────────────────────────────
  console.log("— double tap —");
  const again = (await c.query(`select public.hand_back_paid_job($1) r`, [fx.job])).rows[0].r;
  check("second call is a no-op false", again === false);
  check("still delivered", (await jobRow(fx.job)).status === "delivered");

  // ── 4. a READY paid job goes the same way ───────────────────────────────────
  console.log("— hand_back_paid_job from ready —");
  await rewind(fx.job, "ready");
  await claims(fx.actor);
  check("ready + paid → true", (await c.query(`select public.hand_back_paid_job($1) r`, [fx.job])).rows[0].r === true);
  check("ready + paid → delivered", (await jobRow(fx.job)).status === "delivered");

  // ── 5. refusals leave the job where it was ──────────────────────────────────
  console.log("— refusals —");
  await rewind(fx.job, "scheduled");
  await claims(fx.actor);
  await expectError("a scheduled job is refused",
    `select public.hand_back_paid_job($1)`, [fx.job], "cannot be handed back (status scheduled)");
  check("…and stays scheduled", (await jobRow(fx.job)).status === "scheduled");

  // A bare in-progress job on the same car, no bill at all (inserted here, rolled back).
  await claims(null);
  const noBill = (await c.query(`
    insert into public.jobs (tenant_id, customer_id, vehicle_id, status, started_at)
    select tenant_id, customer_id, vehicle_id, 'in_progress', now() from public.jobs where id = $1
    returning id`, [fx.job])).rows[0];
  await claims(fx.actor);
  await expectError("an in-progress job with no bill is refused",
    `select public.hand_back_paid_job($1)`, [noBill.id], "has no invoice");
  const nb = await jobRow(noBill.id);
  check("…and stays in progress, ready_at untouched", nb.status === "in_progress" && nb.ready_at === null);

  // ── 6. context and grants ───────────────────────────────────────────────────
  console.log("— context and grants —");
  await claims(null);
  await expectError("no tenant context is refused",
    `select public.hand_back_paid_job($1)`, [fx.job], "no tenant context");
  const anon = (await c.query(
    `select has_function_privilege('anon', 'public.hand_back_paid_job(uuid)', 'execute') x`)).rows[0].x;
  check("anon cannot execute", anon === false);
  const auth = (await c.query(
    `select has_function_privilege('authenticated', 'public.hand_back_paid_job(uuid)', 'execute') x`)).rows[0].x;
  check("authenticated can execute", auth === true);
} catch (e) {
  ok = false;
  console.error("✗ unexpected error:", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(ok ? "\nPASS (rolled back)" : "\nFAIL (rolled back)");
process.exit(ok ? 0 : 1);
