-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a job estimate can span days, not just hours
--
-- The tablet's "Takes about" is becoming a days + hours picker: a ceramic coating that
-- has to cure, a rebuild that runs over a weekend. The old CHECK capped the estimate at
-- 1440 minutes (one day), which a multi-day pick would violate. Raise the ceiling to 30
-- days; the derived ETA and the "running late" alarm already handle any duration.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.jobs drop constraint if exists chk_jobs_estimated_minutes;
alter table public.jobs
  add constraint chk_jobs_estimated_minutes
  check (estimated_minutes is null or (estimated_minutes >= 1 and estimated_minutes <= 43200)); -- 30 days
