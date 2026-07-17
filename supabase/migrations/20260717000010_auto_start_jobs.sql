-- ═══════════════════════════════════════════════════════════════════════════
-- A booked job starts itself when its moment comes.
--
-- Owner: "say a job is scheduled to start at 15hr — it should automatically move
-- to in progress when reaching that time." Until now a scheduled job sat there
-- until a human pressed Start; if everyone was busy with a car, the board lied
-- about what was actually underway.
--
-- Done in the DATABASE, not in either app, so the web back office and every
-- tablet see the same truth the instant they next read the board — no client
-- has to be awake for it to happen. Pure SQL on a one-minute pg_cron tick; no
-- HTTP callback, no secret, nothing to reach outside Postgres.
--
-- THE CLOCK STARTS FROM THE BOOKING (owner's choice): started_at = scheduled_at,
-- not now(). A car booked for 15:00 that the shop only actually touches at 15:40
-- shows the full 40-minute slip, because the booking is the promise being
-- measured — the job clock (JobClock / jobs.started_at) already counts elapsed
-- time from started_at, so this is the honest origin.
--
-- The flip is a SYSTEM act: it runs with no auth.uid(), which is precisely how
-- the job-transition guard (collection_lifecycle.sql) recognises a trusted
-- server change and waves it through. The audit row records actor NULL — nobody
-- pressed anything — which the feeds render as "auto".
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.auto_start_due_jobs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_started integer := 0;
  j record;
begin
  -- One row at a time so each gets its own audit entry, and a single bad row
  -- can't sink the whole tick. The set is tiny (jobs due in the last minute).
  for j in
    select id, tenant_id, scheduled_at
      from public.jobs
     where status = 'scheduled'
       and scheduled_at is not null
       and scheduled_at <= now()
     order by scheduled_at
     for update skip locked
  loop
    update public.jobs
       set status = 'in_progress',
           started_at = j.scheduled_at   -- clock from the booking, not from now()
     where id = j.id;

    insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
    values (j.tenant_id, null, 'job_auto_started', 'job', j.id,
            jsonb_build_object('scheduled_at', j.scheduled_at));

    v_started := v_started + 1;
  end loop;

  return v_started;
end $$;

-- Cron only — never a browser or tablet. auth.uid() would be null for them too,
-- but there is no reason to expose a cross-tenant flip to any session.
revoke execute on function public.auto_start_due_jobs() from public, anon, authenticated;

-- ─── run it every minute, entirely inside the database ───────────────────────
create extension if not exists pg_cron;

-- Idempotent: drop a previous definition of this schedule before re-adding, so
-- re-running the migration doesn't stack duplicate ticks.
do $$
begin
  perform cron.unschedule('auto-start-due-jobs')
   where exists (select 1 from cron.job where jobname = 'auto-start-due-jobs');
exception when others then
  null; -- cron schema not ready on first pass; the schedule below still runs
end $$;

select cron.schedule('auto-start-due-jobs', '* * * * *', $$ select public.auto_start_due_jobs() $$);
