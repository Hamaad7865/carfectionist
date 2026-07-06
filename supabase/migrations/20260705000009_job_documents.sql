-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration 0009 (link jobs ⇄ documents)
-- A job can raise a quote (at intake) and an invoice (on completion). Both are
-- ordinary draft documents carrying job_id + origin='from_job', pre-filled with
-- an editable service line drawn from the job's service text (jobs.notes).
--
-- The builder autosaves via save_draft, whose payload does NOT carry vehicle_id,
-- origin or job_id — so the old save_draft would null the vehicle link and reset
-- origin to 'standalone' on the first autosave. This migration hardens save_draft
-- to PRESERVE any field the builder doesn't manage, and keeps 'from_job' sticky.
-- Additive only.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── save_draft — now link-preserving (vehicle/origin/job survive autosave) ───
create or replace function public.save_draft(p_doc jsonb, p_lines jsonb, p_expected_rev int default null)
returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_id       uuid;
  v_doc      public.documents;
  v_customer uuid := nullif(p_doc->>'customer_id','')::uuid;
  v_vehicle  uuid := nullif(p_doc->>'vehicle_id','')::uuid;
  v_template uuid := nullif(p_doc->>'template_id','')::uuid;
  v_job      uuid := nullif(p_doc->>'job_id','')::uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  -- Tenant-ownership guards. This is SECURITY DEFINER, so the FK checks below run
  -- with owner rights and BYPASS RLS on the referenced tables — a raw RPC payload
  -- could otherwise point a draft at another tenant's customer/vehicle/template/job
  -- (leaking PII into an issued invoice, or spoofing a from_job link). Reject any
  -- client-supplied reference that isn't ours.
  if v_customer is not null and not exists (select 1 from public.customers          where id = v_customer and tenant_id = v_tenant) then
    raise exception 'unknown customer'; end if;
  if v_vehicle  is not null and not exists (select 1 from public.vehicles           where id = v_vehicle  and tenant_id = v_tenant) then
    raise exception 'unknown vehicle'; end if;
  if v_template is not null and not exists (select 1 from public.document_templates  where id = v_template and tenant_id = v_tenant) then
    raise exception 'unknown template'; end if;
  if v_job      is not null and not exists (select 1 from public.jobs               where id = v_job      and tenant_id = v_tenant) then
    raise exception 'unknown job'; end if;
  -- Line products must be ours too — a foreign product_id would otherwise fire a
  -- sale stock movement against another tenant's product on issue.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) l
    where nullif(l->>'product_id','') is not null
      and not exists (select 1 from public.products pr where pr.id = (l->>'product_id')::uuid and pr.tenant_id = v_tenant)
  ) then raise exception 'unknown product on a line'; end if;

  v_id := coalesce(nullif(p_doc->>'id','')::uuid, gen_random_uuid());
  select * into v_doc from public.documents where id = v_id and tenant_id = v_tenant for update;

  if found then
    if v_doc.status <> 'draft' then raise exception 'cannot edit an issued document'; end if;
    if p_expected_rev is not null and v_doc.revision <> p_expected_rev then
      raise exception 'document was modified elsewhere (rev % expected %)', v_doc.revision, p_expected_rev;
    end if;
    -- customer_id + template_overrides are builder-managed (a blank clears them).
    -- vehicle_id / template_id / valid_until / due_date / job_id are preserved
    -- when the payload omits them, so the builder can never sever a link it does
    -- not surface. origin stays 'from_job' once set — a job link is permanent.
    update public.documents set
      doc_type           = coalesce(nullif(p_doc->>'doc_type','')::doc_type, doc_type),
      customer_id        = v_customer,
      vehicle_id         = coalesce(v_vehicle, vehicle_id),
      template_id        = coalesce(v_template, template_id),
      template_overrides = coalesce(p_doc->'template_overrides', template_overrides),
      valid_until        = coalesce(nullif(p_doc->>'valid_until','')::date, valid_until),
      due_date           = coalesce(nullif(p_doc->>'due_date','')::date, due_date),
      origin             = case when origin = 'from_job' then origin
                                else coalesce(nullif(p_doc->>'origin',''), origin) end,
      job_id             = coalesce(v_job, job_id),
      revision           = revision + 1
    where id = v_id returning * into v_doc;
  else
    insert into public.documents
      (id, tenant_id, doc_type, status, customer_id, vehicle_id, template_id,
       template_overrides, valid_until, due_date, origin, job_id, created_by)
    values
      (v_id, v_tenant, coalesce(nullif(p_doc->>'doc_type','')::doc_type, 'quote'), 'draft',
       v_customer, v_vehicle, v_template, coalesce(p_doc->'template_overrides', '{}'::jsonb),
       nullif(p_doc->>'valid_until','')::date, nullif(p_doc->>'due_date','')::date,
       coalesce(nullif(p_doc->>'origin',''), 'standalone'), v_job,
       app.current_app_user_id())
    returning * into v_doc;
  end if;

  delete from public.document_lines where document_id = v_id;
  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order)
  select
    v_tenant, v_id,
    nullif(l->>'product_id','')::uuid,
    coalesce(l->>'title',''),
    nullif(l->>'description',''),
    coalesce((l->>'qty')::numeric, 1),
    coalesce((l->>'unit_price')::numeric, 0),
    coalesce((l->>'discount_pct')::numeric, 0),
    coalesce((l->>'vat_rate')::numeric, 15),
    coalesce((l->>'sort_order')::int, (ord - 1)::int)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(l, ord);

  select * into v_doc from public.documents where id = v_id;  -- totals set by trigger
  return v_doc;
end $$;

-- ─── create_document_from_job — draft quote/invoice pre-filled from a job ─────
create or replace function public.create_document_from_job(p_job_id uuid, p_doc_type doc_type)
returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_job    public.jobs;
  v_bs     public.business_settings;
  v_id     uuid := gen_random_uuid();
  v_doc    public.documents;
  v_title  text;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');
  if p_doc_type not in ('quote','invoice') then
    raise exception 'a job document must be a quote or invoice, not %', p_doc_type;
  end if;

  select * into v_job from public.jobs where id = p_job_id and tenant_id = v_tenant;
  if not found then raise exception 'job not found'; end if;
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

  -- One editable ad-hoc service line from the job's service text (price left 0
  -- for the operator to set). Consumables are internal cost, not billed here.
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
end $$;

revoke execute on function public.create_document_from_job(uuid, doc_type) from public;
grant  execute on function public.create_document_from_job(uuid, doc_type) to authenticated;
