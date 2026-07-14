-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a revision re-prices the car, it does not re-open it
--
-- revise_quote makes a NEW quote carrying the old one's lines and its job_id. But
-- convert_quote_to_job finds a job by source_quote_id — and a revision has a new id —
-- so accepting one opened a SECOND job for the same vehicle: two cards on the board for
-- one car, and the original still billed at the price the customer had rejected.
--
-- The obvious fix — re-point the job at the new quote — is forbidden, and rightly:
-- jobs_guard makes source_quote_id immutable. A job is born of one quote and that
-- lineage is a fact, not a field. So the job keeps its parent, and the BILL is what
-- moves: every quote accepted against a job carries that job's id, and the invoice is
-- priced from the newest one. The customer is charged what they signed last.
--
-- Once the job has been invoiced the money is real; re-pricing it then would quietly
-- change what was charged. That is refused — a credit note is the honest correction.
--
-- Two functions, each the LIVE body plus one branch.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.convert_quote_to_job(
  p_quote_id uuid,
  p_technician_id uuid,
  p_scheduled_at timestamptz default null,
  p_signature jsonb default null
)
returns jobs
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  -- A REVISION of a quote whose job already exists (revise_quote carries job_id forward).
  -- Same car, same job — only the agreed price moved. Accept it against the job that is
  -- already on the board rather than opening a second card. The job's source_quote_id is
  -- deliberately immutable, so its lineage stays put; the invoice below follows the
  -- newest accepted quote instead.
  if v_q.source_document_id is not null and v_q.job_id is not null then
    select * into v_job from public.jobs where id = v_q.job_id and tenant_id = v_tenant;
    if found then
      if exists (
        select 1 from public.documents
         where tenant_id = v_tenant and job_id = v_job.id
           and doc_type = 'invoice' and status <> 'void'
      ) then
        raise exception 'this job has already been invoiced — issue a credit note rather than re-pricing the bill';
      end if;

      update public.jobs
         set notes         = coalesce(nullif(btrim(v_service), ''), notes),
             technician_id = coalesce(p_technician_id, technician_id),
             scheduled_at  = coalesce(p_scheduled_at, scheduled_at)
       where id = v_job.id
       returning * into v_job;

      update public.documents
         set status = 'accepted', job_id = v_job.id,
             accepted_signature = coalesce(v_sig, accepted_signature)
       where id = v_q.id;

      insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
      values (v_tenant, v_actor, 'quote_revision_accepted', 'document', v_q.id,
              jsonb_build_object('job_id', v_job.id, 'quote_number', v_q.number,
                                 'replaces', v_q.source_document_id, 'signed', v_sig is not null));

      return v_job;
    end if;
  end if;

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
end $function$;


-- ── the bill follows the quote signed LAST ──────────────────────────────────
create or replace function public.create_document_from_job(p_job_id uuid, p_doc_type doc_type)
returns documents
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_job    public.jobs;
  v_bs     public.business_settings;
  v_id     uuid := gen_random_uuid();
  v_doc    public.documents;
  v_title  text;
  v_quote  uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');
  if p_doc_type not in ('quote','invoice') then
    raise exception 'a job document must be a quote or invoice, not %', p_doc_type;
  end if;

  select * into v_job from public.jobs where id = p_job_id and tenant_id = v_tenant;
  if not found then raise exception 'job not found'; end if;

  -- The bill for a quoted job IS its quote — every line, every price, the order discount
  -- and the lineage — instead of a blank line someone has to retype. Where the quote was
  -- revised and re-signed, the NEWEST accepted one is the price that stands: the job's own
  -- source_quote_id is immutable and still names the first version. Idempotent:
  -- convert_quote_to_invoice returns the invoice that already exists, from either path.
  if p_doc_type = 'invoice' then
    -- The newest accepted quote is the LEAF of the revision chain: the one no accepted
    -- revision supersedes. Following the links rather than the clock is exact — two
    -- quotes raised in the same transaction share a created_at, and a tie there would
    -- pick the price at random.
    select d.id into v_quote
      from public.documents d
     where d.tenant_id = v_tenant and d.job_id = v_job.id
       and d.doc_type = 'quote' and d.status = 'accepted'
       and not exists (
         select 1 from public.documents c
          where c.tenant_id = v_tenant and c.source_document_id = d.id
            and c.doc_type = 'quote' and c.status = 'accepted'
       )
     order by d.created_at desc
     limit 1;

    v_quote := coalesce(v_quote, v_job.source_quote_id);
    if v_quote is not null then
      return public.convert_quote_to_invoice(v_quote);
    end if;
  end if;

  -- One live document of each type per job — no unbounded drafts / double-billing.
  if exists (
    select 1 from public.documents
     where tenant_id = v_tenant and job_id = v_job.id and doc_type = p_doc_type and status <> 'void'
  ) then raise exception 'this job already has a % — open it instead of creating another', p_doc_type; end if;

  select * into v_bs from public.business_settings where id = v_tenant;

  -- Draft header, linked to the job (customer + vehicle copied from it).
  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, origin,
     template_overrides, created_by)
  values
    (v_id, v_tenant, p_doc_type, 'draft', v_job.customer_id, v_job.vehicle_id, v_job.id, 'from_job',
     '{}'::jsonb, v_actor)
  returning * into v_doc;

  -- No quote to inherit from: one editable ad-hoc service line from the job's service
  -- text (price left 0 for the operator to set). Consumables are internal cost, not
  -- billed here.
  v_title := coalesce(nullif(btrim(v_job.notes), ''), 'Service work');
  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order)
  values
    (v_tenant, v_id, null, v_title, null, 1, 0, 0, coalesce(v_bs.vat_rate, 15), 0);

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'document_from_job', 'document', v_id,
          jsonb_build_object('job_id', v_job.id, 'doc_type', p_doc_type));

  select * into v_doc from public.documents where id = v_id;  -- totals via trigger
  return v_doc;
end $function$;
