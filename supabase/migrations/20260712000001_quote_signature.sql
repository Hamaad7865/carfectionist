-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — client signature at quote acceptance
-- The customer signs on the tablet before "Create job"; the POS uploads the
-- PNG to the private vehicle-photos bucket (tenant-first path rule) and hands
-- the path to convert_quote_to_job, which stamps it onto the quote IN THE SAME
-- TRANSACTION as the acceptance — a quote can never read 'accepted with
-- signature' without the acceptance itself having happened, and vice versa.
--
-- documents.accepted_signature jsonb: { "path": <storage path>, "name": <who
-- signed>, "at": <server timestamp> }. Server stamps 'at' — the tablet clock
-- is not an authority. The web back office may still accept without a
-- signature (owner override); the tablet UI requires one.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.documents add column if not exists accepted_signature jsonb;
comment on column public.documents.accepted_signature is
  'Client signature captured at acceptance: {path, name, at} — path in vehicle-photos';

-- Signature change (new defaulted param) would otherwise create an overload.
drop function if exists public.convert_quote_to_job(uuid, uuid, timestamptz);

create or replace function public.convert_quote_to_job(
  p_quote_id uuid,
  p_technician_id uuid,
  p_scheduled_at timestamptz default null,
  p_signature jsonb default null
) returns public.jobs language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_actor   uuid := app.current_app_user_id();
  v_q       public.documents;
  v_job     public.jobs;
  v_service text;
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

  -- Idempotent: already converted — hand back the same job, but back-fill the
  -- signature if the first accept's response was lost before the client saw it.
  select * into v_job from public.jobs
   where source_quote_id = v_q.id and tenant_id = v_tenant;
  if found then
    if v_sig is not null and v_q.accepted_signature is null then
      update public.documents set accepted_signature = v_sig where id = v_q.id;
    end if;
    return v_job;
  end if;

  if v_q.customer_id is null then raise exception 'this quote has no customer — add one before starting a job'; end if;
  if v_q.vehicle_id  is null then raise exception 'this quote has no vehicle — add one before starting a job'; end if;
  if p_technician_id is not null and not exists (
    select 1 from public.app_users where id = p_technician_id and tenant_id = v_tenant
  ) then raise exception 'unknown technician'; end if;

  if v_q.status = 'draft' then
    select * into v_q from public.issue_document(v_q.id, null, 'quote-accept:' || v_q.id);
  elsif v_q.status <> 'issued' then
    raise exception 'this quote is % and cannot be converted to a job', v_q.status;
  end if;

  select title into v_service from public.document_lines
   where document_id = v_q.id order by sort_order limit 1;

  insert into public.jobs
    (tenant_id, customer_id, vehicle_id, technician_id, scheduled_at, notes,
     status, checklist, damage_markers, source_quote_id, created_by)
  values
    (v_tenant, v_q.customer_id, v_q.vehicle_id, p_technician_id, p_scheduled_at,
     coalesce(nullif(btrim(v_service), ''), 'From quote ' || v_q.number), 'scheduled',
     '[{"label":"Intake photos & damage check","done":false},{"label":"Wash & prep","done":false},{"label":"Service work","done":false},{"label":"Final inspection","done":false}]'::jsonb,
     coalesce(v_q.intake->'markers', '[]'::jsonb),
     v_q.id, v_actor)
  returning * into v_job;

  for r in select value from jsonb_array_elements(coalesce(v_q.intake->'photos', '[]'::jsonb)) loop
    if nullif(r->>'path', '') is not null then
      insert into public.job_photos (tenant_id, job_id, storage_path, caption, phase, created_by)
      values (v_tenant, v_job.id, r->>'path', nullif(r->>'caption', ''), 'before', v_actor);
    end if;
  end loop;

  update public.documents
     set status = 'accepted', job_id = v_job.id,
         accepted_signature = coalesce(v_sig, accepted_signature)
   where id = v_q.id;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'quote_converted_to_job', 'document', v_q.id,
          jsonb_build_object('job_id', v_job.id, 'quote_number', v_q.number,
                             'signed', v_sig is not null));

  return v_job;
end $$;

revoke execute on function public.convert_quote_to_job(uuid, uuid, timestamptz, jsonb) from public;
grant  execute on function public.convert_quote_to_job(uuid, uuid, timestamptz, jsonb) to authenticated;
