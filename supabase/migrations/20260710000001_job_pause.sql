-- Pause/resume for the job timer (Android POS work order).
--   paused_at  — set while the timer is paused (when the pause started); null = running.
--   paused_ms  — accumulated paused time, folded in on each resume.
-- Elapsed = (now | ready_at) - started_at - paused_ms - (now - paused_at when paused).
-- Nullable + defaulted, so existing rows and the web app are unaffected.
alter table public.jobs
  add column if not exists paused_at timestamptz,
  add column if not exists paused_ms bigint not null default 0;

comment on column public.jobs.paused_at is 'Job timer: paused since (null = running)';
comment on column public.jobs.paused_ms is 'Job timer: accumulated paused milliseconds';
