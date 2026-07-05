-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration 0007 (departments + appointments)
-- Departments (place of work) on jobs; an appointments/booking table that can
-- be converted into a job. Department is free text (app supplies the picker) so
-- new departments never need a migration.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Departments on jobs ─────────────────────────────────────────────────────
alter table jobs add column if not exists department text;

-- ─── Appointments ────────────────────────────────────────────────────────────
create table if not exists appointments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references business_settings(id),
  customer_id    uuid not null references customers(id),
  vehicle_id     uuid not null references vehicles(id),
  service        text,
  department     text,
  technician_id  uuid references app_users(id),
  scheduled_at   timestamptz not null,
  duration_minutes integer,
  status         text not null default 'scheduled'
                   check (status in ('scheduled','confirmed','arrived','done','cancelled','no_show')),
  notes          text,
  job_id         uuid references jobs(id),
  created_by     uuid references app_users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_appointments_when on appointments(tenant_id, scheduled_at);
create index if not exists idx_appointments_status on appointments(tenant_id, status);

drop trigger if exists trg_appointments_updated on appointments;
create trigger trg_appointments_updated before update on appointments
  for each row execute function app.set_updated_at();

alter table appointments enable row level security;

drop policy if exists appointments_select on appointments;
drop policy if exists appointments_insert on appointments;
drop policy if exists appointments_update on appointments;
drop policy if exists appointments_delete on appointments;

create policy appointments_select on appointments for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy appointments_insert on appointments for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));
create policy appointments_update on appointments for update to authenticated
  using (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));
create policy appointments_delete on appointments for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()));
