-- Re-accepting a multi-car quote reconciles cars instead of replaying history.
--
-- BUGHUNT M4: the idempotent early-return handed back the old job set without
-- re-checking the car list — accept with 1 car, edit the lines to 3, re-accept,
-- and cars 2–3 silently never got jobs (and shrinking the quote orphaned cards
-- without a word). Now: cars without a live job get one (accept means do the
-- work); a live job whose car left the quote refuses instead of orphaning —
-- cancel that card first. Cancelled jobs are history and cover nothing.
-- Otherwise byte-identical to the live body (splices would drift across a
-- function this size; cf. 20260802000010's precedent for full restatement).
CREATE OR REPLACE FUNCTION public.convert_quote_to_jobs(p_quote_id uuid, p_technician_id uuid, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_signature jsonb DEFAULT NULL::jsonb)
 RETURNS SETOF jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_actor   uuid := app.current_app_user_id();
  v_q       public.documents;
  v_job     public.jobs;
  v_car     record;
  v_cars    int;
  v_service text;
  v_intake  jsonb;
  v_first   uuid;
  v_ids     uuid[] := '{}';
  v_created int := 0;
  v_stale_id uuid;
  v_stale_plate text;
  v_sig     jsonb := case when p_signature is null then null
                          else p_signature || jsonb_build_object('at', now()) end;
  r         jsonb;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents
   where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;

  select count(*) into v_cars from app.document_cars(v_q.id);

  -- The ordinary quote: one car, one job, the path that has always run.
  if v_cars <= 1 then
    return query select * from public.convert_quote_to_job(p_quote_id, p_technician_id, p_scheduled_at, p_signature);
    return;
  end if;

  -- A lost accept response retried: stamp the signature it carried, whenever
  -- the jobs below already exist. Never an early return on its own — the car
  -- list may have moved since, and the reconcile below owns that question.
  if exists (select 1 from public.jobs where source_quote_id = v_q.id and tenant_id = v_tenant) then
    if v_sig is not null and v_q.accepted_signature is null then
      update public.documents set accepted_signature = v_sig where id = v_q.id;
    end if;
  end if;

  if v_q.customer_id is null then raise exception 'this quote has no customer — add one before starting a job'; end if;
  if p_technician_id is not null and not exists (
    select 1 from public.app_users where id = p_technician_id and tenant_id = v_tenant
  ) then raise exception 'unknown technician'; end if;

  -- Re-pricing a quote that covers several cars would have to void and re-raise
  -- the bill and carry deposits across three jobs. That needs its own design;
  -- say so plainly rather than half-applying the single-car path.
  if v_q.source_document_id is not null then
    raise exception 'a quote covering several cars cannot be revised yet — quote the cars separately, or start a new quotation';
  end if;

  if v_q.status = 'draft' then
    select * into v_q from public.issue_document(v_q.id, null, 'quote-accept:' || v_q.id);
  elsif v_q.status = 'accepted' then
    null;  -- signed earlier, came back for the work
  elsif v_q.status <> 'issued' then
    raise exception 'this quote is % and cannot be converted to a job', v_q.status;
  end if;

  -- A live job whose car is no longer quoted refuses before anything is
  -- created: its card would otherwise orphan silently. Cancel it first — that
  -- is the deliberate path, with its own bill resolution.
  select j.id, coalesce(v.plate, left(j.vehicle_id::text, 8)) into v_stale_id, v_stale_plate
    from public.jobs j
    left join public.vehicles v on v.id = j.vehicle_id
   where j.source_quote_id = v_q.id and j.tenant_id = v_tenant and j.status <> 'cancelled'
     and not exists (select 1 from app.document_cars(v_q.id) c where c.vehicle_id = j.vehicle_id)
   limit 1;
  if found then
    raise exception 'car % is no longer on this quote — cancel job % first', v_stale_plate, left(v_stale_id::text, 8);
  end if;

  for v_car in select c.vehicle_id, c.ord from app.document_cars(v_q.id) c order by c.ord loop
    -- Already worked: a live job covers this car, so accepting again changes
    -- nothing for it. Only uncovered cars fall through to creation below.
    perform 1 from public.jobs
     where source_quote_id = v_q.id and tenant_id = v_tenant
       and vehicle_id = v_car.vehicle_id and status <> 'cancelled';
    if found then continue; end if;

    select dl.title into v_service from public.document_lines dl
     where dl.document_id = v_q.id and dl.vehicle_id = v_car.vehicle_id
     order by dl.sort_order limit 1;

    -- That car's condition, out of either intake shape.
    v_intake := app.intake_for_vehicle(v_q.intake, v_car.vehicle_id);

    insert into public.jobs
      (tenant_id, customer_id, vehicle_id, technician_id, scheduled_at, notes,
       status, checklist, damage_markers, source_quote_id, created_by)
    values
      (v_tenant, v_q.customer_id, v_car.vehicle_id, p_technician_id, p_scheduled_at,
       coalesce(nullif(btrim(v_service), ''), 'From quote ' || v_q.number), 'scheduled',
       '[{"label":"Intake photos & damage check","done":false},{"label":"Wash & prep","done":false},{"label":"Service work","done":false},{"label":"Final inspection","done":false}]'::jsonb,
       coalesce(v_intake->'markers', '[]'::jsonb),
       v_q.id, v_actor)
    returning * into v_job;

    v_ids := v_ids || v_job.id;
    if v_first is null then v_first := v_job.id; end if;
    v_created := v_created + 1;

    -- The before-photos reception took of THIS car.
    for r in select value from jsonb_array_elements(coalesce(v_intake->'photos', '[]'::jsonb)) loop
      if nullif(r->>'path', '') is not null then
        insert into public.job_photos (tenant_id, job_id, storage_path, caption, phase, created_by)
        values (v_tenant, v_job.id, r->>'path', nullif(r->>'caption', ''), 'before', v_actor);
      end if;
    end loop;

    insert into public.document_jobs (tenant_id, document_id, job_id)
    values (v_tenant, v_q.id, v_job.id) on conflict do nothing;
  end loop;

  -- No new cars: anchor the claims below on the first live job instead of
  -- nulling the quote's job link.
  if v_first is null then
    select id into v_first from public.jobs
     where source_quote_id = v_q.id and tenant_id = v_tenant
     order by created_at, id limit 1;
  end if;

  -- "Bill now" can have raised an invoice from this quote before any job existed.
  update public.documents
     set job_id = v_first
   where tenant_id = v_tenant and doc_type = 'invoice'
     and status <> 'void' and job_id is null
     and source_document_id = v_q.id;

  -- Every document raised from this quote covers every one of its jobs.
  insert into public.document_jobs (tenant_id, document_id, job_id)
  select v_tenant, d.id, j.id
    from public.documents d
    cross join unnest(v_ids) as j(id)
   where d.tenant_id = v_tenant and d.source_document_id = v_q.id and d.status <> 'void'
  on conflict do nothing;

  update public.documents
     set status = 'accepted', job_id = v_first,
         accepted_signature = coalesce(v_sig, accepted_signature)
   where id = v_q.id;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'quote_converted_to_jobs', 'document', v_q.id,
          jsonb_build_object('job_ids', to_jsonb(v_ids), 'cars', v_cars,
                             'quote_number', v_q.number, 'signed', v_sig is not null));

  return query select * from public.jobs
    where source_quote_id = v_q.id and tenant_id = v_tenant order by created_at, id;
end $function$;
