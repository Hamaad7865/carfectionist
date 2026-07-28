-- ═══════════════════════════════════════════════════════════════════════════
-- Owner requests (2026-07-28):
--   • create technicians in settings, and assign SEVERAL to one job
--   • comments on a job
--   • a vehicle can be marked as coated, with a note
--
-- Three additive changes plus one relaxed constraint. Nothing existing moves:
-- jobs.technician_id stays as the job's LEAD technician (every screen, report and
-- the web still read it), and the new join table carries the rest of the crew.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. A technician need not be able to log in ──────────────────────────────
-- app_users.auth_user_id was NOT NULL, so adding a technician meant creating a
-- Supabase auth user — which the tablet cannot do (it would need the service
-- role). A detailer who never touches the POS is a staff RECORD, not an account.
-- Relaxing this is safe: app.current_app_user_id() matches on auth_user_id, and
-- a NULL simply never matches, which is exactly right for someone with no login.
alter table public.app_users alter column auth_user_id drop not null;

comment on column public.app_users.auth_user_id is
  'Supabase auth user. NULL = a staff record with no login (e.g. a technician who is only ever assigned to jobs).';

-- One login per person still holds for those who have one.
create unique index if not exists app_users_auth_user_id_key
  on public.app_users (auth_user_id) where auth_user_id is not null;

-- ─── 2. Several technicians on one job ───────────────────────────────────────
create table if not exists public.job_technicians (
  job_id        uuid not null references public.jobs(id) on delete cascade,
  app_user_id   uuid not null references public.app_users(id),
  tenant_id     uuid not null references public.business_settings(id),
  created_at    timestamptz not null default now(),
  primary key (job_id, app_user_id)
);
create index if not exists idx_job_technicians_job on public.job_technicians(job_id);

alter table public.job_technicians enable row level security;
create policy jt_select on public.job_technicians for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy jt_write on public.job_technicians for all to authenticated
  using (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));
grant select, insert, update, delete on public.job_technicians to authenticated;

-- Backfill: whoever is already the lead is also a member of the crew, so a
-- reader can use ONE source (the join table) without losing existing history.
insert into public.job_technicians (job_id, app_user_id, tenant_id)
select j.id, j.technician_id, j.tenant_id
  from public.jobs j
 where j.technician_id is not null
on conflict do nothing;

-- ─── 3. Comments on a job ────────────────────────────────────────────────────
-- A thread, not a single free-text box: jobs.notes already exists and is the
-- job's standing description, whereas a comment is dated, attributed and appended.
create table if not exists public.job_comments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.business_settings(id),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  body        text not null check (length(btrim(body)) > 0),
  created_by  uuid references public.app_users(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_job_comments_job on public.job_comments(job_id, created_at desc);

alter table public.job_comments enable row level security;
create policy jc_select on public.job_comments for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy jc_insert on public.job_comments for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));
-- Deleting someone else's comment is an owner/manager decision; edits are not
-- offered at all, so the thread reads as what was actually said at the time.
create policy jc_delete on public.job_comments for delete to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) in ('owner','manager'));
grant select, insert, delete on public.job_comments to authenticated;

-- ─── 4. Is this car coated, and anything worth remembering about it ──────────
-- The studio's whole business is coating, so "has this one been done" is a
-- standing fact about the CAR, not something to re-read from old job history.
alter table public.vehicles add column if not exists is_coated boolean not null default false;
alter table public.vehicles add column if not exists coated_at date;

comment on column public.vehicles.is_coated is
  'Marked by staff on the contact card. vehicles.notes carries the free-text comment.';
