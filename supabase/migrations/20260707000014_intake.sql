-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration 0014 (Reception / Intake module)
-- Captures a vehicle's arrival condition — damage markers + before-photos — on a
-- draft QUOTE (quote-first flow), then a "Start job" carries them into the JOB.
--   intake  = { markers:[{x,y,type,note?}], photos:[{path,caption?}] }  (x,y % 0–100)
-- Additive: documents.intake jsonb, job_photos.phase, and two RPCs. save_draft is
-- re-created to PRESERVE intake across builder autosaves (like it already does for
-- job_id/origin/vehicle). Photos live in the private vehicle-photos bucket; only
-- their object paths are stored here (no file moves when the job is created).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.documents  add column if not exists intake jsonb;
alter table public.job_photos add column if not exists phase text not null default 'before'
  check (phase in ('before','after'));

-- ─── save_draft — also preserves `intake` (builder never sends it) ────────────
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

  if v_customer is not null and not exists (select 1 from public.customers          where id = v_customer and tenant_id = v_tenant) then
    raise exception 'unknown customer'; end if;
  if v_vehicle  is not null and not exists (select 1 from public.vehicles           where id = v_vehicle  and tenant_id = v_tenant) then
    raise exception 'unknown vehicle'; end if;
  if v_template is not null and not exists (select 1 from public.document_templates  where id = v_template and tenant_id = v_tenant) then
    raise exception 'unknown template'; end if;
  if v_job      is not null and not exists (select 1 from public.jobs               where id = v_job      and tenant_id = v_tenant) then
    raise exception 'unknown job'; end if;
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
      intake             = coalesce(p_doc->'intake', intake),   -- builder omits it → preserve
      revision           = revision + 1
    where id = v_id returning * into v_doc;
  else
    insert into public.documents
      (id, tenant_id, doc_type, status, customer_id, vehicle_id, template_id,
       template_overrides, valid_until, due_date, origin, job_id, intake, created_by)
    values
      (v_id, v_tenant, coalesce(nullif(p_doc->>'doc_type','')::doc_type, 'quote'), 'draft',
       v_customer, v_vehicle, v_template, coalesce(p_doc->'template_overrides', '{}'::jsonb),
       nullif(p_doc->>'valid_until','')::date, nullif(p_doc->>'due_date','')::date,
       coalesce(nullif(p_doc->>'origin',''), 'standalone'), v_job, p_doc->'intake',
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

-- ─── create_intake_quote — draft quote holding the arrival condition ──────────
create or replace function public.create_intake_quote(
  p_customer_id uuid, p_new_customer_name text, p_new_customer_phone text,
  p_vehicle_id uuid, p_new_vehicle_plate text, p_new_vehicle_make text,
  p_service text, p_markers jsonb, p_photos jsonb
) returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_cust   uuid := p_customer_id;
  v_veh    uuid := p_vehicle_id;
  v_id     uuid := gen_random_uuid();
  v_bs     public.business_settings;
  v_doc    public.documents;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier','technician');

  -- Customer: existing (ours) or created inline (reuses create_job's resolution).
  if v_cust is not null then
    if not exists (select 1 from public.customers where id = v_cust and tenant_id = v_tenant) then
      raise exception 'unknown customer'; end if;
  else
    if coalesce(btrim(p_new_customer_name), '') = '' then raise exception 'pick a customer or add a new one'; end if;
    insert into public.customers (tenant_id, name, phone)
    values (v_tenant, btrim(p_new_customer_name), nullif(btrim(p_new_customer_phone), ''))
    returning id into v_cust;
  end if;
  -- Vehicle: existing (belongs to that customer) or created inline.
  if v_veh is not null then
    if not exists (select 1 from public.vehicles where id = v_veh and customer_id = v_cust and tenant_id = v_tenant) then
      raise exception 'that vehicle does not belong to the selected customer'; end if;
  else
    if coalesce(btrim(p_new_vehicle_plate), '') = '' then raise exception 'pick a vehicle or add one'; end if;
    insert into public.vehicles (tenant_id, customer_id, plate, make)
    values (v_tenant, v_cust, btrim(p_new_vehicle_plate), nullif(btrim(p_new_vehicle_make), ''))
    returning id into v_veh;
  end if;

  select * into v_bs from public.business_settings where id = v_tenant;

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, origin, intake, template_overrides, created_by)
  values
    (v_id, v_tenant, 'quote', 'draft', v_cust, v_veh, 'standalone',
     jsonb_build_object('markers', coalesce(p_markers, '[]'::jsonb), 'photos', coalesce(p_photos, '[]'::jsonb)),
     '{}'::jsonb, v_actor)
  returning * into v_doc;

  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order)
  values
    (v_tenant, v_id, null, coalesce(nullif(btrim(p_service), ''), 'Service work'), null, 1, 0, 0, coalesce(v_bs.vat_rate, 15), 0);

  select * into v_doc from public.documents where id = v_id;  -- totals via trigger
  return v_doc;
end $$;
revoke execute on function public.create_intake_quote(uuid, text, text, uuid, text, text, text, jsonb, jsonb) from public;
grant  execute on function public.create_intake_quote(uuid, text, text, uuid, text, text, text, jsonb, jsonb) to authenticated;

-- ─── create_job_from_document — the reverse of create_document_from_job ───────
create or replace function public.create_job_from_document(p_document_id uuid)
returns public.jobs language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_actor   uuid := app.current_app_user_id();
  v_doc     public.documents;
  v_job     public.jobs;
  v_service text;
  r         jsonb;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_doc from public.documents where id = p_document_id and tenant_id = v_tenant for update;
  if not found then raise exception 'document not found'; end if;
  if v_doc.job_id is not null then raise exception 'this document already has a job'; end if;
  if v_doc.status = 'void' then raise exception 'cannot start a job from a void document'; end if;
  if v_doc.customer_id is null or v_doc.vehicle_id is null then raise exception 'the quote needs a customer and a vehicle first'; end if;

  select title into v_service from public.document_lines where document_id = v_doc.id order by sort_order limit 1;

  insert into public.jobs (tenant_id, customer_id, vehicle_id, damage_markers, notes, status, checklist, created_by)
  values (v_tenant, v_doc.customer_id, v_doc.vehicle_id,
          coalesce(v_doc.intake->'markers', '[]'::jsonb), nullif(v_service, ''), 'scheduled',
          '[{"label":"Intake photos & damage check","done":false},{"label":"Wash & prep","done":false},{"label":"Service work","done":false},{"label":"Final inspection","done":false}]'::jsonb,
          v_actor)
  returning * into v_job;

  -- Before-photos captured at intake → job_photos (files already in the bucket).
  for r in select value from jsonb_array_elements(coalesce(v_doc.intake->'photos', '[]'::jsonb)) loop
    if nullif(r->>'path', '') is not null then
      insert into public.job_photos (tenant_id, job_id, storage_path, caption, phase, created_by)
      values (v_tenant, v_job.id, r->>'path', nullif(r->>'caption', ''), 'before', v_actor);
    end if;
  end loop;

  update public.documents set job_id = v_job.id where id = v_doc.id;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'job_from_document', 'job', v_job.id, jsonb_build_object('document_id', v_doc.id));

  return v_job;
end $$;
revoke execute on function public.create_job_from_document(uuid) from public;
grant  execute on function public.create_job_from_document(uuid) to authenticated;
