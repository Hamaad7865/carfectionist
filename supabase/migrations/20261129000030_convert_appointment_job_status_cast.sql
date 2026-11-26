-- Follow-up fix: CASE expressions must return the jobs.status enum, not text.
-- The original function was installed but start-now could not update the enum.

create or replace function public.convert_appointment_to_job(
  p_appointment_id uuid,
  p_start_now boolean default false,
  p_checklist jsonb default '[]'::jsonb
)
returns public.jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_appointment public.appointments;
  v_job public.jobs;
  v_now timestamptz := now();
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner', 'manager', 'cashier');

  select *
    into v_appointment
    from public.appointments
   where id = p_appointment_id
     and tenant_id = v_tenant
     for update;

  if not found then raise exception 'appointment not found'; end if;
  if v_appointment.job_id is not null then
    raise exception 'this appointment is already a job';
  end if;
  if v_appointment.status not in ('scheduled', 'confirmed', 'arrived') then
    raise exception 'only a scheduled, confirmed or arrived appointment can become a job';
  end if;

  v_job := public.create_job(
    v_appointment.customer_id,
    null,
    null,
    v_appointment.vehicle_id,
    null,
    null,
    v_appointment.service,
    v_appointment.technician_id,
    v_appointment.department,
    coalesce(p_checklist, '[]'::jsonb)
  );

  update public.jobs
     set scheduled_at = case when p_start_now then v_now else v_appointment.scheduled_at end,
         estimated_minutes = v_appointment.duration_minutes,
         status = case
           when p_start_now then 'in_progress'::public.job_status
           else 'scheduled'::public.job_status
         end,
         started_at = case when p_start_now then v_now else null end
   where id = v_job.id
  returning * into v_job;

  update public.appointments
     set job_id = v_job.id,
         status = case when p_start_now then 'arrived' else status end
   where id = p_appointment_id;

  return v_job;
end $$;

revoke all on function public.convert_appointment_to_job(uuid, boolean, jsonb) from public, anon;
grant execute on function public.convert_appointment_to_job(uuid, boolean, jsonb) to authenticated;
