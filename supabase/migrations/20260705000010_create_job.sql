-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration 0010 (atomic job intake)
-- create_job resolves-or-creates the customer + vehicle and inserts the job in
-- ONE transaction, so a failure can never leave an orphan customer/vehicle (the
-- prior server action did three separate writes with best-effort rollback).
-- Validates tenant ownership of any supplied ids (SECURITY DEFINER bypasses RLS).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.create_job(
  p_customer_id uuid,
  p_new_customer_name text,
  p_new_customer_phone text,
  p_vehicle_id uuid,
  p_new_vehicle_plate text,
  p_new_vehicle_make text,
  p_service text,
  p_technician_id uuid,
  p_department text,
  p_checklist jsonb
) returns public.jobs language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_cust   uuid := p_customer_id;
  v_veh    uuid := p_vehicle_id;
  v_job    public.jobs;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier','technician');

  -- Customer: existing (ours) or created inline.
  if v_cust is not null then
    if not exists (select 1 from public.customers where id = v_cust and tenant_id = v_tenant) then
      raise exception 'unknown customer'; end if;
  else
    if coalesce(btrim(p_new_customer_name), '') = '' then raise exception 'pick a customer or add a new one'; end if;
    insert into public.customers (tenant_id, name, phone)
    values (v_tenant, btrim(p_new_customer_name), nullif(btrim(p_new_customer_phone), ''))
    returning id into v_cust;
  end if;

  -- Vehicle: existing (must belong to that customer + tenant) or created inline.
  if v_veh is not null then
    if not exists (select 1 from public.vehicles where id = v_veh and customer_id = v_cust and tenant_id = v_tenant) then
      raise exception 'that vehicle does not belong to the selected customer'; end if;
  else
    if coalesce(btrim(p_new_vehicle_plate), '') = '' then raise exception 'pick a vehicle or add one'; end if;
    insert into public.vehicles (tenant_id, customer_id, plate, make)
    values (v_tenant, v_cust, btrim(p_new_vehicle_plate), nullif(btrim(p_new_vehicle_make), ''))
    returning id into v_veh;
  end if;

  if p_technician_id is not null and not exists (
    select 1 from public.app_users where id = p_technician_id and tenant_id = v_tenant
  ) then raise exception 'unknown technician'; end if;

  insert into public.jobs (tenant_id, customer_id, vehicle_id, technician_id, department, notes, status, checklist, created_by)
  values (v_tenant, v_cust, v_veh, p_technician_id, nullif(p_department, ''), nullif(p_service, ''), 'scheduled', coalesce(p_checklist, '[]'::jsonb), v_actor)
  returning * into v_job;
  return v_job;
end $$;

revoke execute on function public.create_job(uuid, text, text, uuid, text, text, text, uuid, text, jsonb) from public;
grant  execute on function public.create_job(uuid, text, text, uuid, text, text, text, uuid, text, jsonb) to authenticated;
