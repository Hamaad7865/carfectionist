-- ═══════════════════════════════════════════════════════════════════════════
-- Fix the 28 July crew backfill (20260728000010_technicians_comments_coating.sql)
-- and stop it happening again.
--
-- That migration backfilled job_technicians with every job's EXISTING lead, so
-- the lead ended up BOTH on jobs.technician_id AND in job_technicians. The
-- invariant is: the lead lives on jobs.technician_id, everyone else lives in
-- job_technicians, NEVER both. With the duplicate in place, removing the sole
-- technician from a pre-migration job (which only ever touched jobs.technician_id)
-- left the stale crew row behind, and the technician reappeared on next read.
--
-- Fix in two parts:
--   1. delete exactly the duplicated rows — where the crew member IS the lead;
--   2. a trigger that refuses the same duplication from any surface (web direct
--      insert, tablet direct insert, or a future RPC), because a CHECK constraint
--      cannot see across jobs and job_technicians.
--
-- The trigger must not fight a legitimate PROMOTION — moving someone from crew
-- to lead by updating jobs.technician_id to a person who is already in the crew.
-- That is not the bug; it is the normal way a lead changes. So:
--   • job_technicians blocks an INSERT/UPDATE that would duplicate the CURRENT
--     lead into the crew;
--   • jobs, after technician_id changes, quietly drops the new lead's own crew
--     row (if any) instead of failing the promotion.
-- Both triggers only ever touch rows for the job being written, so neither can
-- deadlock against unrelated jobs; the job_technicians trigger takes no lock on
-- jobs (a plain SELECT), and the jobs trigger's DELETE runs after the jobs row's
-- own update lock is already held, in the transaction's normal lock order.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Remove the duplicates the 28 July backfill created ───────────────────
delete from public.job_technicians jt
 using public.jobs j
 where jt.job_id = j.id
   and jt.app_user_id = j.technician_id;

-- ─── 2a. Refuse the lead being added to their own job's crew ─────────────────
create or replace function app.forbid_lead_in_crew() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lead uuid;
begin
  select technician_id into v_lead from public.jobs where id = new.job_id;
  if v_lead is not null and v_lead = new.app_user_id then
    raise exception 'this technician already leads the job — the lead is not also crew';
  end if;
  return new;
end $$;

create trigger trg_job_technicians_no_lead_dup
  before insert or update of app_user_id, job_id on public.job_technicians
  for each row execute function app.forbid_lead_in_crew();

-- ─── 2b. A promotion (crew member becomes lead) drops their own crew row ─────
-- Fires only when technician_id actually changes to someone. Silent cleanup,
-- not a failure — assignTechnicianAction / the tablet's lead picker must keep
-- working exactly as before; they never knew job_technicians existed.
create or replace function app.demote_lead_from_crew() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.technician_id is not null and new.technician_id is distinct from old.technician_id then
    delete from public.job_technicians
     where job_id = new.id and app_user_id = new.technician_id;
  end if;
  return new;
end $$;

create trigger trg_jobs_lead_promoted_from_crew
  after update of technician_id on public.jobs
  for each row execute function app.demote_lead_from_crew();
