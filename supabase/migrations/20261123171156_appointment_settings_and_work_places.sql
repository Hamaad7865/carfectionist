-- Tenant-owned places of work and configurable appointment reminders.
--
-- jobs.department / appointments.department remain text snapshots for history.
-- The managed work_places list is what new work may select. Deleting a place
-- therefore removes the picker option without rewriting old jobs or bookings.

alter table public.business_settings
  add column if not exists appointment_reminder_days smallint not null default 3;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.business_settings'::regclass
       and conname = 'business_settings_appointment_reminder_days_check'
  ) then
    alter table public.business_settings
      add constraint business_settings_appointment_reminder_days_check
      check (appointment_reminder_days between 1 and 30);
  end if;
end $$;

comment on column public.business_settings.appointment_reminder_days is
  'Show bell reminders for live appointments due in the next N days, inclusive of today.';

create table if not exists public.work_places (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.business_settings(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 60),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_work_places_tenant_name
  on public.work_places(tenant_id, lower(btrim(name)));
create index if not exists idx_work_places_tenant_order
  on public.work_places(tenant_id, sort_order, name);

drop trigger if exists trg_work_places_updated on public.work_places;
create trigger trg_work_places_updated before update on public.work_places
  for each row execute function app.set_updated_at();

alter table public.work_places enable row level security;

drop policy if exists work_places_select on public.work_places;
create policy work_places_select on public.work_places
  for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

revoke all on public.work_places from public, anon, authenticated;
grant select on public.work_places to authenticated;

-- Convert the four original picker slugs once. From here on the selected place's
-- human name is what jobs and appointments snapshot.
update public.jobs
   set department = left(case lower(btrim(department))
     when 'detailing_studio' then 'Detailing studio'
     when 'car_wash' then 'Car wash'
     when 'technical' then 'Technical jobs'
     when 'garage' then 'Garage'
     else btrim(department)
   end, 60)
 where nullif(btrim(department), '') is not null;

update public.appointments
   set department = left(case lower(btrim(department))
     when 'detailing_studio' then 'Detailing studio'
     when 'car_wash' then 'Car wash'
     when 'technical' then 'Technical jobs'
     when 'garage' then 'Garage'
     else btrim(department)
   end, 60)
 where nullif(btrim(department), '') is not null;

-- Historical rows sometimes differ only by case or accidental spaces. Give each
-- tenant one canonical spelling before the place list is seeded and later renamed.
with snapshots as (
  select tenant_id, department as name
    from public.jobs
   where nullif(department, '') is not null
  union all
  select tenant_id, department as name
    from public.appointments
   where nullif(department, '') is not null
), canonical as (
  select tenant_id, lower(name) as key, min(name) as name
    from snapshots
   group by tenant_id, lower(name)
)
update public.jobs j
   set department = c.name
  from canonical c
 where j.tenant_id = c.tenant_id
   and lower(j.department) = c.key
   and j.department is distinct from c.name;

with snapshots as (
  select tenant_id, department as name
    from public.jobs
   where nullif(department, '') is not null
  union all
  select tenant_id, department as name
    from public.appointments
   where nullif(department, '') is not null
), canonical as (
  select tenant_id, lower(name) as key, min(name) as name
    from snapshots
   group by tenant_id, lower(name)
)
update public.appointments a
   set department = c.name
  from canonical c
 where a.tenant_id = c.tenant_id
   and lower(a.department) = c.key
   and a.department is distinct from c.name;

-- Preserve every real department already in a tenant's data.
with used as (
  select tenant_id, btrim(department) as name
    from public.jobs
   where nullif(btrim(department), '') is not null
  union
  select tenant_id, btrim(department) as name
    from public.appointments
   where nullif(btrim(department), '') is not null
), unique_used as (
  select tenant_id, min(name) as name
    from used
   group by tenant_id, lower(name)
)
insert into public.work_places (tenant_id, name, sort_order)
select tenant_id, name, 10
  from unique_used
on conflict do nothing;

-- Detailing tenants keep the original choices. A tyre centre is a different
-- business: start with its own trading name instead of Carfectionist vocabulary.
insert into public.work_places (tenant_id, name, sort_order)
select bs.id, d.name, d.sort_order
  from public.business_settings bs
 cross join (values
   ('Detailing studio', 10),
   ('Car wash', 20),
   ('Technical jobs', 30),
   ('Garage', 40)
 ) as d(name, sort_order)
 where bs.id not in (
   '1f060b86-ad63-4dc7-93fb-a1fdfae18b27',
   '44444444-4444-4444-8444-000000000004'
 )
on conflict do nothing;

insert into public.work_places (tenant_id, name, sort_order)
select id, left(coalesce(nullif(btrim(trading_name), ''), legal_name), 60), 10
  from public.business_settings
 where id in (
   '1f060b86-ad63-4dc7-93fb-a1fdfae18b27',
   '44444444-4444-4444-8444-000000000004'
 )
   and not exists (
     select 1 from public.work_places wp where wp.tenant_id = business_settings.id
   )
on conflict do nothing;

-- A freshly provisioned tenant starts with one honest place: its own business.
create or replace function app.default_work_place_for_new_tenant()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.work_places (tenant_id, name, sort_order)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.trading_name), ''), nullif(btrim(new.legal_name), ''), 'Main workshop'), 60),
    10
  )
  on conflict do nothing;
  return null;
end $$;
revoke all on function app.default_work_place_for_new_tenant() from public, anon, authenticated;
drop trigger if exists trg_business_settings_default_work_place on public.business_settings;
create trigger trg_business_settings_default_work_place after insert on public.business_settings
  for each row execute function app.default_work_place_for_new_tenant();

create or replace function public.save_work_place(p_id uuid, p_name text)
returns public.work_places
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_name text := btrim(p_name);
  v_old public.work_places;
  v_row public.work_places;
begin
  perform app.require_role('owner', 'manager');
  if v_tenant is null then raise exception 'no tenant context'; end if;
  if v_name is null or length(v_name) not between 1 and 60 then
    raise exception 'a place of work needs a name of 1–60 characters';
  end if;

  if p_id is not null then
    select * into v_old
      from public.work_places
     where id = p_id and tenant_id = v_tenant
     for update;
    if not found then raise exception 'unknown place of work'; end if;
  end if;

  if exists (
    select 1
      from public.work_places
     where tenant_id = v_tenant
       and lower(btrim(name)) = lower(v_name)
       and (p_id is null or id <> p_id)
  ) then
    raise exception 'a place of work with that name already exists';
  end if;

  if p_id is null then
    insert into public.work_places (tenant_id, name, sort_order)
    select v_tenant, v_name, coalesce(max(sort_order), 0) + 10
      from public.work_places
     where tenant_id = v_tenant
    returning * into v_row;
  else
    update public.work_places set name = v_name
     where id = p_id
    returning * into v_row;

    -- Renaming a managed place corrects current and historical labels too.
    if v_old.name is distinct from v_name then
      update public.jobs
         set department = v_name
       where tenant_id = v_tenant and department = v_old.name;
      update public.appointments
         set department = v_name
       where tenant_id = v_tenant and department = v_old.name;
    end if;
  end if;

  return v_row;
end $$;
revoke all on function public.save_work_place(uuid, text) from public, anon, authenticated;
grant execute on function public.save_work_place(uuid, text) to authenticated;

create or replace function public.delete_work_place(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  perform app.require_role('owner', 'manager');
  if v_tenant is null then raise exception 'no tenant context'; end if;

  delete from public.work_places
   where id = p_id and tenant_id = v_tenant;
  if not found then raise exception 'unknown place of work'; end if;
  return true;
end $$;
revoke all on function public.delete_work_place(uuid) from public, anon, authenticated;
grant execute on function public.delete_work_place(uuid) to authenticated;

-- Proof: every tenant has a reminder window, and no two picker names collide.
do $$
begin
  if exists (
    select 1 from public.business_settings
     where appointment_reminder_days not between 1 and 30
  ) then
    raise exception 'invalid appointment reminder window';
  end if;
  if exists (
    select 1 from public.work_places
     group by tenant_id, lower(btrim(name))
    having count(*) > 1
  ) then
    raise exception 'duplicate tenant work places';
  end if;
end $$;