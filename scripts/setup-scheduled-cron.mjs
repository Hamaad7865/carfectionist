// One-time activation of the scheduled-send heartbeat.
//
//   node scripts/setup-scheduled-cron.mjs
//
// Enables pg_cron + pg_net on the database and schedules a job that POSTs
// /api/cron/run every 2 minutes. That endpoint claims due scheduled sends and
// reminders and dispatches them. Authorisation is sha256(SERVICE_ROLE_KEY) —
// a value the Worker already holds — so there is no new secret to provision.
//
// Idempotent: re-running replaces the job rather than duplicating it.
import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DB_URL } from "./_env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envTxt = fs.readFileSync(path.join(root, "apps/web/.env.local"), "utf8");
const svc = (envTxt.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
if (!svc) {
  console.error("SUPABASE_SERVICE_ROLE_KEY not found in apps/web/.env.local");
  process.exit(1);
}
const authHash = crypto.createHash("sha256").update(svc).digest("hex");

const INTERVAL = "*/2 * * * *"; // every 2 minutes
const URL = "https://app-carfectionist.com/api/cron/run";

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  console.log("Enabling pg_cron + pg_net…");
  await c.query("create extension if not exists pg_cron");
  await c.query("create extension if not exists pg_net");

  // Replace any prior job so re-running never duplicates the heartbeat.
  await c.query(
    "do $$ begin if exists (select 1 from cron.job where jobname='process-scheduled-sends') then perform cron.unschedule('process-scheduled-sends'); end if; end $$;",
  );

  const command = `
    select net.http_post(
      url := '${URL}',
      headers := jsonb_build_object('content-type','application/json','x-cron-key','${authHash}'),
      body := '{}'::jsonb,
      timeout_milliseconds := 25000
    );`;
  await c.query("select cron.schedule('process-scheduled-sends', $1, $2)", [INTERVAL, command]);

  const jobs = await c.query("select jobid, jobname, schedule, active from cron.job where jobname='process-scheduled-sends'");
  console.log("\n✓ Scheduled-send heartbeat is live:");
  console.table(jobs.rows);
  console.log("\nWatch it run:  select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname='process-scheduled-sends') order by start_time desc limit 5;");
} catch (e) {
  console.error("✗ Failed:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
