-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — how long a job should take, and a board that speaks up
--
-- Two additions, no rewrites.
--
-- 1. jobs.estimated_minutes — the one thing the schema could not answer: how long is
--    this car expected to take? Set per job when it is booked. Everything downstream
--    (the "est. finish" on both job cards, the tablet's running-late alert) is derived
--    from it plus the clock we already keep, so nothing else needs storing. Null means
--    nobody estimated — callers must render nothing rather than invent a time.
--
-- 2. jobs joins the realtime publication. A "car is ready" is an event caused by
--    another person on another device; no local alarm can predict it, so the tablet has
--    to be told. As a bonus the jobs board goes live — cards move between columns as
--    they change instead of on a manual reload.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.jobs
  add column if not exists estimated_minutes int;

-- A day of work is the ceiling; zero or negative is a data-entry slip, not an estimate.
alter table public.jobs
  drop constraint if exists chk_jobs_estimated_minutes;
alter table public.jobs
  add constraint chk_jobs_estimated_minutes
  check (estimated_minutes is null or (estimated_minutes >= 1 and estimated_minutes <= 1440));

comment on column public.jobs.estimated_minutes is
  'How long this job is expected to take, in minutes. Set when booked. Null = not estimated; '
  'the estimated finish is derived (scheduled/started + this + pauses), never stored.';

-- Realtime: the tablet listens for status flips (a job going ready) and re-arms its
-- schedule alarms when a booking moves. Guarded — re-running must not error.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jobs'
  ) then
    alter publication supabase_realtime add table public.jobs;
  end if;
end $$;

-- Without this, an UPDATE's "old" row on the wire is the primary key and nothing else,
-- so a listener cannot tell "this job just BECAME ready" from "this already-ready job was
-- touched again" — and the front desk gets told the same car is done every time anyone
-- edits it. Full replica identity ships the previous row so the edge is visible.
alter table public.jobs replica identity full;
