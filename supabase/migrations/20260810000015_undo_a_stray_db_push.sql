-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — undo a stray `supabase db push`.
--
-- On 2026-08-10 a `npm run db:push` ran against production for the first time
-- ever. supabase_migrations.schema_migrations was EMPTY, so the CLI concluded
-- nothing had been applied and started from file one. It got through the first
-- 21 before dying on this repo's duplicate timestamp prefixes.
--
-- Re-running an early file re-installs its early-July function bodies. Postgres
-- keeps one version of a function, not a history, and the later migrations that
-- spliced onto those bodies were not re-run — so every splice added since 8 July
-- was thrown away. Two distinct kinds of damage resulted:
--
--   SAME signature  -> the old body REPLACED the current one. Six functions lost
--                      line_kind, rich line content, unit labels and comments.
--   CHANGED signature -> the old body was created BESIDE the current one as a
--                      second overload. Three functions gained a stale twin, and
--                      because an exact arity match beats a defaulted parameter,
--                      a short call resolved to the STALE one. The worst was
--                      import_products(p_rows, p_dry_run) — the version with no
--                      VAT guard, which would have loaded gross shelf prices
--                      without the ÷1.15 conversion.
--
-- The money path survived untouched: issue_document, record_payment and
-- reverse_payment had all gained parameters in later migrations, so the old
-- files' versions no longer matched their signatures and could not overwrite
-- them. Verified directly — the replay-before-guard fix, the day guard and the
-- shop-floor stock deduction are all still in place, and the canonical VAT
-- vector is unmoved.
--
-- HOW THE BODIES BELOW WERE OBTAINED. Not retyped from an older migration —
-- that is the very mistake this repairs, and the one 20260802000010 warns about.
-- Every migration after 20260710000001 was replayed inside a transaction that
-- was then ROLLED BACK, and the function definitions the chain produced were
-- read out of pg_get_functiondef. These are therefore exactly what the migration
-- history says these functions should be, captured rather than reconstructed by
-- hand. Replaying against production directly was rejected: ten of those files
-- carry data statements, one of which assigns quote numbers off a gapless
-- series, and re-running an intermediate file would revert functions that LATER
-- files changed — the same trap again.
--
-- convert_quote_to_invoice has no line_kind on purpose. 20260804000020 excluded
-- it deliberately: the job-or-sale question is asked of a quote once, as it is
-- accepted, and an invoice never asks it.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.convert_quote_to_invoice(p_quote_id uuid)
 RETURNS documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_q   public.documents;
  v_inv public.documents;
  v_new uuid := gen_random_uuid();
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;

  -- Whatever quote the caller named, bill the one that stands for this job: the price
  -- signed last, or — if none was ever signed — the price the customer was last quoted.
  -- Accepting a quote issues it, so quote numbers run in the order they were agreed.
  if v_q.job_id is not null then
    select * into v_inv from public.documents
     where tenant_id = v_tenant and job_id = v_q.job_id
       and doc_type = 'quote' and status in ('accepted','issued')
     order by (status = 'accepted') desc, number desc nulls last, created_at desc
     limit 1;
    if found and v_inv.id <> v_q.id then
      select * into v_q from public.documents where id = v_inv.id for update;
    end if;
  end if;

  -- S3: a declined / expired / void quote is not billable.
  if v_q.status not in ('draft','issued','accepted') then
    raise exception 'cannot invoice a % quote', v_q.status;
  end if;

  -- Idempotent, and S1: return an existing live invoice whether it was raised
  -- from THIS quote (source_document_id) or from the quote's JOB (job_id).
  select * into v_inv from public.documents
   where doc_type = 'invoice' and tenant_id = v_tenant and status <> 'void'
     and ( source_document_id = v_q.id
           or (v_q.job_id is not null and job_id = v_q.job_id) )
   order by created_at
   limit 1;
  if found then return v_inv; end if;

  -- Billing a quote nobody ever sent: the counter IS the negotiation, so raising the
  -- bill issues and accepts it in one move. Below the idempotency branch, so a replay
  -- hands back the invoice without minting a second number. See the header for what a
  -- draft left behind here costs: a row the app can neither open, archive nor delete.
  if v_q.status = 'draft' then
    update public.documents set
      number     = app.next_document_number(v_tenant, 'quote'),
      status     = 'accepted',
      -- the MAURITIUS calendar day, as issue_document stamps it (UTC evenings
      -- otherwise file the day before)
      issue_date = coalesce(issue_date, ((now() at time zone 'utc') + interval '4 hours')::date),
      issued_at  = coalesce(issued_at, now())
     where id = v_q.id
    returning * into v_q;
  end if;

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, discount_kind, discount_value, created_by)
  values
    (v_new, v_tenant, 'invoice', 'draft', v_q.customer_id, v_q.vehicle_id, v_q.job_id, v_q.id,
     v_q.template_id, v_q.template_overrides, v_q.currency, v_q.origin, v_q.discount_kind, v_q.discount_value, app.current_app_user_id())
  returning * into v_inv;

  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order)
  select v_tenant, v_new, product_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order
  from public.document_lines where document_id = v_q.id;

  update public.documents set status = 'accepted' where id = v_q.id and status = 'issued';
  select * into v_inv from public.documents where id = v_new;
  return v_inv;
end $function$
;

CREATE OR REPLACE FUNCTION public.create_document_from_job(p_job_id uuid, p_doc_type doc_type)
 RETURNS documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- and the lineage — not a blank line someone has to retype. Signed beats merely sent;
  -- either beats inventing a price. convert_quote_to_invoice settles WHICH quote.
  if p_doc_type = 'invoice' then
    select id into v_quote
      from public.documents
     where tenant_id = v_tenant and job_id = v_job.id
       and doc_type = 'quote' and status in ('accepted','issued')
     order by (status = 'accepted') desc, number desc nulls last, created_at desc
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

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, origin,
     template_overrides, created_by)
  values
    (v_id, v_tenant, p_doc_type, 'draft', v_job.customer_id, v_job.vehicle_id, v_job.id, 'from_job',
     '{}'::jsonb, v_actor)
  returning * into v_doc;

  -- No quote at all: one editable ad-hoc service line from the job's service text
  -- (price left 0 for the operator to set).
  v_title := coalesce(nullif(btrim(v_job.notes), ''), 'Service work');
  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order, line_kind)
  values
    (v_tenant, v_id, null, v_title, null, 1, 0, 0, coalesce(v_bs.vat_rate, 15), 0, 'service');

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'document_from_job', 'document', v_id,
          jsonb_build_object('job_id', v_job.id, 'doc_type', p_doc_type));

  select * into v_doc from public.documents where id = v_id;  -- totals via trigger
  return v_doc;
end $function$
;

CREATE OR REPLACE FUNCTION public.create_intake_quote(p_customer_id uuid, p_new_customer_name text, p_new_customer_phone text, p_vehicle_id uuid, p_new_vehicle_plate text, p_new_vehicle_make text, p_service text, p_markers jsonb, p_photos jsonb)
 RETURNS documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order, line_kind)
  values
    (v_tenant, v_id, null, coalesce(nullif(btrim(p_service), ''), 'Service work'), null, 1, 0, 0, coalesce(v_bs.vat_rate, 15), 0, 'service');

  select * into v_doc from public.documents where id = v_id;  -- totals via trigger
  return v_doc;
end $function$
;

CREATE OR REPLACE FUNCTION public.duplicate_document(p_id uuid)
 RETURNS documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_src public.documents;
  v_new uuid := gen_random_uuid();
  v_dup public.documents;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_src from public.documents where id = p_id and tenant_id = v_tenant;
  if not found then raise exception 'document not found'; end if;
  if v_src.doc_type = 'credit_note' then raise exception 'credit notes cannot be duplicated'; end if;

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, discount_kind, discount_value, created_by)
  values
    (v_new, v_tenant, v_src.doc_type, 'draft', v_src.customer_id, v_src.vehicle_id, v_src.job_id, v_src.id,
     v_src.template_id, v_src.template_overrides, v_src.currency, v_src.origin, v_src.discount_kind, v_src.discount_value, app.current_app_user_id())
  returning * into v_dup;

  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind)
  select v_tenant, v_new, product_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind
  from public.document_lines where document_id = v_src.id;

  select * into v_dup from public.documents where id = v_new;
  return v_dup;
end $function$
;

CREATE OR REPLACE FUNCTION public.revise_quote(p_quote_id uuid)
 RETURNS documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_q   public.documents;
  v_new uuid := gen_random_uuid();
  v_rev public.documents;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents where id = p_quote_id and tenant_id = v_tenant;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'only quotes can be revised'; end if;

  -- Revising the same quote twice forks two rival revisions of one price, and nothing
  -- downstream can say which the customer meant. Revise the latest one instead.
  if exists (
    select 1 from public.documents c
     where c.tenant_id = v_tenant and c.source_document_id = v_q.id
       and c.doc_type = 'quote' and c.status <> 'void'
  ) then
    raise exception 'this quote has already been revised — open the latest revision instead of starting a second one';
  end if;

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, discount_kind, discount_value, created_by)
  values
    (v_new, v_tenant, 'quote', 'draft', v_q.customer_id, v_q.vehicle_id, v_q.job_id, v_q.id,
     v_q.template_id, v_q.template_overrides, v_q.currency, v_q.origin, v_q.discount_kind, v_q.discount_value, app.current_app_user_id())
  returning * into v_rev;

  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind)
  select v_tenant, v_new, product_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind
  from public.document_lines where document_id = v_q.id;

  select * into v_rev from public.documents where id = v_new;
  return v_rev;
end $function$
;

CREATE OR REPLACE FUNCTION public.save_draft(p_doc jsonb, p_lines jsonb, p_expected_rev integer DEFAULT NULL::integer)
 RETURNS documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      intake             = coalesce(p_doc->'intake', intake),
      discount_kind      = case when p_doc ? 'discount_kind'  then nullif(p_doc->>'discount_kind','')          else discount_kind  end,
      discount_value     = case when p_doc ? 'discount_value' then coalesce((p_doc->>'discount_value')::numeric,0) else discount_value end,
      comment            = case when p_doc ? 'comment'        then nullif(p_doc->>'comment','')                else comment        end,
      revision           = revision + 1
    where id = v_id returning * into v_doc;
  else
    insert into public.documents
      (id, tenant_id, doc_type, status, customer_id, vehicle_id, template_id,
       template_overrides, valid_until, due_date, origin, job_id, intake,
       discount_kind, discount_value, comment, created_by)
    values
      (v_id, v_tenant, coalesce(nullif(p_doc->>'doc_type','')::doc_type, 'quote'), 'draft',
       v_customer, v_vehicle, v_template, coalesce(p_doc->'template_overrides', '{}'::jsonb),
       nullif(p_doc->>'valid_until','')::date, nullif(p_doc->>'due_date','')::date,
       coalesce(nullif(p_doc->>'origin',''), 'standalone'), v_job, p_doc->'intake',
       nullif(p_doc->>'discount_kind',''), coalesce((p_doc->>'discount_value')::numeric,0),
       nullif(p_doc->>'comment',''),
       app.current_app_user_id())
    returning * into v_doc;
  end if;

  delete from public.document_lines where document_id = v_id;
  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, description_richtext, unit_label,
     qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind)
  select
    v_tenant, v_id,
    nullif(l->>'product_id','')::uuid,
    coalesce(l->>'title',''),
    nullif(l->>'description',''),
    case when jsonb_typeof(l->'description_richtext') = 'object'
         then l->'description_richtext' else null end,
    nullif(l->>'unit_label',''),
    coalesce((l->>'qty')::numeric, 1),
    coalesce((l->>'unit_price')::numeric, 0),
    coalesce((l->>'discount_pct')::numeric, 0),
    coalesce(nullif(l->>'discount_kind',''), 'percent'),
    coalesce((l->>'discount_amount')::numeric, 0),
    coalesce((l->>'vat_rate')::numeric, 15),
    coalesce((l->>'sort_order')::int, (ord - 1)::int),
    case when nullif(l->>'product_id','') is null
          then nullif(l->>'line_kind','')::product_kind end /* catalogue lines defer to products.kind */
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(l, ord);

  perform app.recompute_doc_totals(v_id);   -- guarantee totals reflect discount + lines
  select * into v_doc from public.documents where id = v_id;
  return v_doc;
end $function$
;
-- ── the stale twins ─────────────────────────────────────────────────────────
-- Each current version defaults the parameter its stale twin lacks, so dropping
-- the twin sends short calls to the right function instead of the wrong one.
-- `if exists` because on any database that never suffered the stray push, these
-- were never created.
drop function if exists public.import_products(jsonb, boolean);
drop function if exists public.create_and_issue_credit_note(uuid, uuid, boolean);
drop function if exists public.set_staff_pin(uuid, text);
