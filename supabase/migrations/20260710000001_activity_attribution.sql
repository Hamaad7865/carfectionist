-- ═══════════════════════════════════════════════════════════════════════════
-- Activity attribution — capture WHO issued a document and WHO completed a job.
--
-- issue_document only stamped issued_at (not an actor), and complete_job only
-- stamped ready_at. Rather than rewrite those RPCs, a before-update trigger
-- stamps the actor on the exact transition (draft→issued / →ready) using
-- app.current_app_user_id() — which resolves the real session user, so both the
-- web app and the POS tablet attribute correctly. The trigger only fires on the
-- first transition (old timestamp null), so it never touches an already-issued
-- document (no conflict with the fiscal lock).
-- ═══════════════════════════════════════════════════════════════════════════

alter table documents add column if not exists issued_by uuid references app_users(id);
alter table jobs      add column if not exists completed_by uuid references app_users(id);

create or replace function app.stamp_issued_by() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.issued_at is not null and old.issued_at is null and new.issued_by is null then
    new.issued_by := app.current_app_user_id();
  end if;
  return new;
end $$;
drop trigger if exists trg_stamp_issued_by on documents;
create trigger trg_stamp_issued_by before update on documents
  for each row execute function app.stamp_issued_by();

create or replace function app.stamp_completed_by() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.ready_at is not null and old.ready_at is null and new.completed_by is null then
    new.completed_by := app.current_app_user_id();
  end if;
  return new;
end $$;
drop trigger if exists trg_stamp_completed_by on jobs;
create trigger trg_stamp_completed_by before update on jobs
  for each row execute function app.stamp_completed_by();


-- Folded in from 202607100000015_job_pause.sql (history repair 2026-09-10): that version stamp collided and the Supabase CLI cannot match 15-digit versions, so the two files ship as one. Applied out-of-band before this repair; already live. Do not split apart.

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
