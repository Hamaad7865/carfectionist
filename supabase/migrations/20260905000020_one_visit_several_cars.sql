-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — one visit, several cars (phase 1: the data and the RPCs)
--
-- Yogen brings three cars. Reception should tick all three in ONE intake pass,
-- quote them on ONE quotation grouped by car, and — when he signs — get THREE
-- job cards, one per car, settled by ONE invoice.
--
-- The rule everything else follows: A CHARGE KNOWS ITS CAR. Attribution lives
-- on document_lines.vehicle_id, never in a heading or a naming convention, so
-- the builder, the A4, the slip and the job split cannot disagree about which
-- car a charge belongs to.
--
-- documents.vehicle_id is NOT nulled on a multi-car document. Nulling it would
-- make convert_quote_to_job and create_job_from_document raise "this quote has
-- no vehicle" on a perfectly good three-car quote, and blank every reader that
-- shows a plate. It holds the FIRST car; the car SET is derived by
-- app.document_cars(), and the single-job paths DELEGATE to the multi-car one
-- rather than quietly creating one job for car one and losing the other two.
--
-- No screen changes here. Additive: one nullable column, one junction table,
-- two helpers, one new RPC, and re-pointed guards on four existing ones.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. A line knows its car ─────────────────────────────────────────────────
alter table public.document_lines
  add column if not exists vehicle_id uuid references public.vehicles(id);
create index if not exists idx_lines_vehicle
  on public.document_lines(document_id, vehicle_id) where vehicle_id is not null;
comment on column public.document_lines.vehicle_id is
  'Which car this charge is for. NULL = not attributable to a car (a retail '
  'product, a call-out fee) — those lines print unheaded at the end.';

-- No backfill: an existing single-car document is resolved by the fallback in
-- app.document_cars(). Writing to the lines of an ISSUED document would trip
-- enforce_line_lock, and there is nothing to gain by touching them.

-- ─── 2. One invoice can cover several jobs ───────────────────────────────────
-- documents.job_id holds ONE job and stays exactly as it is (the "one live
-- invoice per job" guard and the re-price path both read it). The junction is
-- the complete index — written for single-job documents too, so readers never
-- need a union.
create table if not exists public.document_jobs (
  tenant_id   uuid not null references public.business_settings(id),
  document_id uuid not null references public.documents(id) on delete cascade,
  job_id      uuid not null references public.jobs(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (document_id, job_id)
);
create index if not exists idx_document_jobs_job on public.document_jobs(tenant_id, job_id);
alter table public.document_jobs enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'document_jobs' and policyname = 'document_jobs_select') then
    create policy document_jobs_select on public.document_jobs for select to authenticated
      using (tenant_id = (select app.current_tenant_id()));
  end if;
end $$;

-- Rows are written by SECURITY DEFINER RPCs only — a client that could insert
-- here could make a bill claim a job it never covered.
revoke all on public.document_jobs from anon;
revoke insert, update, delete on public.document_jobs from authenticated;
grant select on public.document_jobs to authenticated;

-- Backfill from the link that already exists.
insert into public.document_jobs (tenant_id, document_id, job_id)
select d.tenant_id, d.id, d.job_id
  from public.documents d
 where d.job_id is not null
on conflict do nothing;

-- ─── 3. How many cars is a DERIVATION, never a stored flag ───────────────────
create or replace function app.document_cars(p_document_id uuid)
returns table (vehicle_id uuid, ord int)
language sql stable security definer set search_path = public, pg_temp as $$
  with line_cars as (
    select dl.vehicle_id as vid, min(dl.sort_order) as so
      from public.document_lines dl
     where dl.document_id = p_document_id and dl.vehicle_id is not null
     group by dl.vehicle_id
  )
  select vid, (row_number() over (order by so, vid))::int from line_cars
  union all
  -- A document written before this change: its one car is on the header.
  select d.vehicle_id, 1
    from public.documents d
   where d.id = p_document_id and d.vehicle_id is not null
     and not exists (select 1 from line_cars)
$$;
comment on function app.document_cars(uuid) is
  'The cars a document covers, in line order. One row = the ordinary '
  'single-car document; more than one = the grouped kind.';

-- ─── 4. One car''s condition, out of either intake shape ─────────────────────
-- New: {"cars":[{"vehicle_id":…,"markers":[…],"photos":[…]}]}
-- Old: {"markers":[…],"photos":[…]}  (one car, written before this change)
create or replace function app.intake_for_vehicle(p_intake jsonb, p_vehicle uuid)
returns jsonb language sql immutable as $$
  select coalesce(
    (select jsonb_build_object('markers', coalesce(c->'markers', '[]'::jsonb),
                               'photos',  coalesce(c->'photos',  '[]'::jsonb))
       from jsonb_array_elements(coalesce(p_intake->'cars', '[]'::jsonb)) c
      where c->>'vehicle_id' = p_vehicle::text
      limit 1),
    case when p_intake ? 'cars'   -- per-car record that simply has none for this car
         then jsonb_build_object('markers', '[]'::jsonb, 'photos', '[]'::jsonb)
         else jsonb_build_object('markers', coalesce(p_intake->'markers', '[]'::jsonb),
                                 'photos',  coalesce(p_intake->'photos',  '[]'::jsonb)) end
  )
$$;

-- ─── 5. One job per car per quote (was: one job per quote, forever) ──────────
drop index if exists public.idx_jobs_source_quote;
create unique index if not exists idx_jobs_source_quote_vehicle
  on public.jobs(source_quote_id, vehicle_id) where source_quote_id is not null;

-- ─── 6. save_draft — a line carries its car, the header follows the lines ────
-- Regenerated from the live definition; the jsonb signature is unchanged, so no
-- overload is created and every existing caller keeps working (a payload with
-- no vehicle_id on its lines behaves exactly as before).
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
  v_first    uuid;
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
  -- A charge can only be for a car this customer owns. Checked here, at the only
  -- writer of builder lines: a table constraint would have to reach across three
  -- tables on every insert, and issued lines are already frozen by the line lock.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) l
    where nullif(l->>'vehicle_id','') is not null
      and not exists (
        select 1 from public.vehicles v
         where v.id = (l->>'vehicle_id')::uuid and v.tenant_id = v_tenant
           and (v_customer is null or v.customer_id = v_customer))
  ) then raise exception 'a line names a car that is not this customer''s'; end if;

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
      discount_reason    = case when p_doc ? 'discount_reason' then nullif(p_doc->>'discount_reason','') else discount_reason end,
      discount_value     = case when p_doc ? 'discount_value' then coalesce((p_doc->>'discount_value')::numeric,0) else discount_value end,
      comment            = case when p_doc ? 'comment'        then nullif(p_doc->>'comment','')                else comment        end,
      revision           = revision + 1
    where id = v_id returning * into v_doc;
  else
    insert into public.documents
      (id, tenant_id, doc_type, status, customer_id, vehicle_id, template_id,
       template_overrides, valid_until, due_date, origin, job_id, intake,
       discount_kind, discount_value, discount_reason, comment, created_by)
    values
      (v_id, v_tenant, coalesce(nullif(p_doc->>'doc_type','')::doc_type, 'quote'), 'draft',
       v_customer, v_vehicle, v_template, coalesce(p_doc->'template_overrides', '{}'::jsonb),
       nullif(p_doc->>'valid_until','')::date, nullif(p_doc->>'due_date','')::date,
       coalesce(nullif(p_doc->>'origin',''), 'standalone'), v_job, p_doc->'intake',
       nullif(p_doc->>'discount_kind',''), coalesce((p_doc->>'discount_value')::numeric,0), nullif(p_doc->>'discount_reason',''),
       nullif(p_doc->>'comment',''),
       app.current_app_user_id())
    returning * into v_doc;
  end if;

  delete from public.document_lines where document_id = v_id;
  insert into public.document_lines
    (tenant_id, document_id, product_id, vehicle_id, title, description, description_richtext, unit_label,
     qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind, price_includes_vat)
  select
    v_tenant, v_id,
    nullif(l->>'product_id','')::uuid,
    nullif(l->>'vehicle_id','')::uuid,
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
          then nullif(l->>'line_kind','')::product_kind end,
    coalesce((l->>'price_includes_vat')::boolean, false) /* catalogue lines defer to products.kind */
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(l, ord);

  -- The header's car follows the lines: the FIRST car, so a multi-car document
  -- still names a real vehicle for every reader and guard that expects one.
  select c.vehicle_id into v_first from app.document_cars(v_id) c order by c.ord limit 1;
  if v_first is not null and v_doc.vehicle_id is distinct from v_first then
    update public.documents set vehicle_id = v_first where id = v_id;
  end if;

  perform app.recompute_doc_totals(v_id);   -- guarantee totals reflect discount + lines
  select * into v_doc from public.documents where id = v_id;
  return v_doc;
end $function$;

-- ─── 7. convert_quote_to_jobs — one job per car, in one transaction ──────────
-- Single-car quotes DELEGATE to convert_quote_to_job, whose revision, re-price,
-- deposit-carry and invoice-claim logic is long and load-bearing and is not
-- touched here. Only the several-cars case is new code.
create or replace function public.convert_quote_to_jobs(
  p_quote_id uuid,
  p_technician_id uuid,
  p_scheduled_at timestamptz default null,
  p_signature jsonb default null
) returns setof public.jobs
language plpgsql security definer set search_path = public, pg_temp as $$
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

  -- Idempotent: already converted — hand back the same jobs, and back-fill the
  -- signature if the first accept's response was lost before the client saw it.
  if exists (select 1 from public.jobs where source_quote_id = v_q.id and tenant_id = v_tenant) then
    if v_sig is not null and v_q.accepted_signature is null then
      update public.documents set accepted_signature = v_sig where id = v_q.id;
    end if;
    return query select * from public.jobs
      where source_quote_id = v_q.id and tenant_id = v_tenant order by created_at, id;
    return;
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

  for v_car in select c.vehicle_id, c.ord from app.document_cars(v_q.id) c order by c.ord loop
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
end $$;

revoke execute on function public.convert_quote_to_jobs(uuid, uuid, timestamptz, jsonb) from public;
grant  execute on function public.convert_quote_to_jobs(uuid, uuid, timestamptz, jsonb) to authenticated;

-- ─── 8. create_job_from_document — delegates rather than truncates ───────────
CREATE OR REPLACE FUNCTION public.create_job_from_document(p_document_id uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  if v_doc.status = 'void' then raise exception 'cannot start a job from a void document'; end if;

  -- Several cars: one job each, through the path that knows how. Creating a
  -- single job here would put one car on the board and lose the rest.
  if v_doc.doc_type = 'quote' and (select count(*) from app.document_cars(v_doc.id)) > 1 then
    return (select j from public.convert_quote_to_jobs(p_document_id, null, null, null) j
             order by j.created_at, j.id limit 1);
  end if;

  if v_doc.job_id is not null then raise exception 'this document already has a job'; end if;
  if v_doc.customer_id is null or v_doc.vehicle_id is null then raise exception 'the quote needs a customer and a vehicle first'; end if;

  select title into v_service from public.document_lines where document_id = v_doc.id order by sort_order limit 1;

  insert into public.jobs (tenant_id, customer_id, vehicle_id, damage_markers, notes, status, checklist, created_by)
  values (v_tenant, v_doc.customer_id, v_doc.vehicle_id,
          coalesce(app.intake_for_vehicle(v_doc.intake, v_doc.vehicle_id)->'markers', '[]'::jsonb),
          nullif(v_service, ''), 'scheduled',
          '[{"label":"Intake photos & damage check","done":false},{"label":"Wash & prep","done":false},{"label":"Service work","done":false},{"label":"Final inspection","done":false}]'::jsonb,
          v_actor)
  returning * into v_job;

  -- Before-photos captured at intake → job_photos (files already in the bucket).
  for r in select value from jsonb_array_elements(
             coalesce(app.intake_for_vehicle(v_doc.intake, v_doc.vehicle_id)->'photos', '[]'::jsonb)) loop
    if nullif(r->>'path', '') is not null then
      insert into public.job_photos (tenant_id, job_id, storage_path, caption, phase, created_by)
      values (v_tenant, v_job.id, r->>'path', nullif(r->>'caption', ''), 'before', v_actor);
    end if;
  end loop;

  update public.documents set job_id = v_job.id where id = v_doc.id;
  insert into public.document_jobs (tenant_id, document_id, job_id)
  values (v_tenant, v_doc.id, v_job.id) on conflict do nothing;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'job_from_document', 'job', v_job.id, jsonb_build_object('document_id', v_doc.id));

  return v_job;
end $function$;

-- ─── 9. convert_quote_to_invoice — the bill inherits each line's car ─────────
-- Regenerated from the live definition. Two additions: the line copy carries
-- vehicle_id, and the invoice claims every job the quote produced.
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
    (tenant_id, document_id, product_id, vehicle_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, price_includes_vat)
  select v_tenant, v_new, product_id, vehicle_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, price_includes_vat
  from public.document_lines where document_id = v_q.id;

  -- One bill, every car's job. Without this, cars two and three read as never
  -- invoiced on the board — documents.job_id can only name one of them.
  insert into public.document_jobs (tenant_id, document_id, job_id)
  select v_tenant, v_new, j.id
    from public.jobs j
   where j.tenant_id = v_tenant
     and (j.source_quote_id = v_q.id or (v_q.job_id is not null and j.id = v_q.job_id))
  on conflict do nothing;

  update public.documents set status = 'accepted' where id = v_q.id and status = 'issued';
  select * into v_inv from public.documents where id = v_new;
  return v_inv;
end $function$;

-- ─── 10. create_intake_quote_cars — reception hands over a LIST of cars ──────
-- A new name, not a new signature on the old one: changing an argument list in
-- Postgres ADDS an overload and leaves the old function live for whatever still
-- matches it. The nine-argument create_intake_quote stays exactly as it is and
-- delegates, so the web keeps working untouched until it is moved over.
--
-- p_cars: [{ vehicle_id | new_plate (+ new_make), markers: [], photos: [],
--            service: "Full detail" }]
create or replace function public.create_intake_quote_cars(
  p_customer_id uuid,
  p_new_customer_name text,
  p_new_customer_phone text,
  p_cars jsonb,
  p_service text default null
) returns public.documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_cust   uuid := p_customer_id;
  v_id     uuid := gen_random_uuid();
  v_bs     public.business_settings;
  v_doc    public.documents;
  v_car    jsonb;
  v_veh    uuid;
  v_cars   jsonb := '[]'::jsonb;
  v_ord    int := 0;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier','technician');

  if jsonb_typeof(coalesce(p_cars, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_cars) = 0 then
    raise exception 'pick at least one car';
  end if;

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

  select * into v_bs from public.business_settings where id = v_tenant;

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, origin, intake, template_overrides, created_by)
  values
    (v_id, v_tenant, 'quote', 'draft', v_cust, 'standalone', '{"cars": []}'::jsonb, '{}'::jsonb, v_actor)
  returning * into v_doc;

  for v_car in select value from jsonb_array_elements(p_cars) loop
    v_veh := nullif(v_car->>'vehicle_id','')::uuid;
    if v_veh is not null then
      if not exists (select 1 from public.vehicles where id = v_veh and customer_id = v_cust and tenant_id = v_tenant) then
        raise exception 'that vehicle does not belong to the selected customer'; end if;
    else
      if coalesce(btrim(v_car->>'new_plate'), '') = '' then raise exception 'pick a vehicle or add one'; end if;
      insert into public.vehicles (tenant_id, customer_id, plate, make)
      values (v_tenant, v_cust, btrim(v_car->>'new_plate'), nullif(btrim(v_car->>'new_make'), ''))
      returning id into v_veh;
    end if;

    -- One opening line per car, so the builder already has a section to fill.
    insert into public.document_lines
      (tenant_id, document_id, product_id, vehicle_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order, line_kind)
    values
      (v_tenant, v_id, null, v_veh,
       coalesce(nullif(btrim(v_car->>'service'), ''), nullif(btrim(p_service), ''), 'Service work'),
       null, 1, 0, 0, coalesce(v_bs.vat_rate, 15), v_ord, 'service');

    v_cars := v_cars || jsonb_build_array(jsonb_build_object(
      'vehicle_id', v_veh,
      'markers', coalesce(v_car->'markers', '[]'::jsonb),
      'photos',  coalesce(v_car->'photos',  '[]'::jsonb)));
    if v_ord = 0 then
      update public.documents set vehicle_id = v_veh where id = v_id;
    end if;
    v_ord := v_ord + 1;
  end loop;

  update public.documents set intake = jsonb_build_object('cars', v_cars) where id = v_id;
  select * into v_doc from public.documents where id = v_id;  -- totals via trigger
  return v_doc;
end $$;

revoke execute on function public.create_intake_quote_cars(uuid, text, text, jsonb, text) from public;
grant  execute on function public.create_intake_quote_cars(uuid, text, text, jsonb, text) to authenticated;

-- ─── 11. convert_quote_to_job — hands a multi-car quote to the new path ──────
-- Regenerated from the live definition (20260729000010) with three changes:
-- the delegation above, condition markers/photos read through
-- app.intake_for_vehicle so either intake shape works, and a document_jobs row
-- so the junction indexes single-job documents too.
CREATE OR REPLACE FUNCTION public.convert_quote_to_job(p_quote_id uuid, p_technician_id uuid, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_signature jsonb DEFAULT NULL::jsonb)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_actor   uuid := app.current_app_user_id();
  v_q       public.documents;
  v_job     public.jobs;
  v_service text;
  v_sig     jsonb := case when p_signature is null then null
                          else p_signature || jsonb_build_object('at', now()) end;
  r         jsonb;
  v_old     public.documents;
  v_new_inv public.documents;
  v_pay     public.payments;
  v_carried numeric := 0;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents
   where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;

  -- Several cars on this quote: the multi-car path owns it. Making ONE job here
  -- would put car one on the board and quietly lose the other two — the single
  -- failure mode this feature must not have. Delegation, not truncation.
  if (select count(*) from app.document_cars(v_q.id)) > 1 then
    return (select j from public.convert_quote_to_jobs(p_quote_id, p_technician_id, p_scheduled_at, p_signature) j
             order by j.created_at, j.id limit 1);
  end if;

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
  elsif v_q.status = 'accepted' then
    -- Already signed, no job yet: the customer accepted the price and went away, and has now
    -- come back for the work. Converting is exactly what should happen. A quote that already
    -- HAS a job falls through to the idempotent branch below and returns that same job.
    null;
  elsif v_q.status <> 'issued' then
    raise exception 'this quote is % and cannot be converted to a job', v_q.status;
  end if;

  select title into v_service from public.document_lines
   where document_id = v_q.id order by sort_order limit 1;

  -- A REVISION of a quote whose job is still alive. Same car, same job — only the agreed
  -- price moved, so accept it against the card already on the board. A CANCELLED job is
  -- not eligible: jobs_guard has no way out of 'cancelled', so re-pricing one would bury
  -- the work where no screen can reach it. Those fall through and open a fresh job.
  if v_q.source_document_id is not null and v_q.job_id is not null then
    select * into v_job from public.jobs
     where id = v_q.job_id and tenant_id = v_tenant and status <> 'cancelled';
    if found then
      -- An invoice raised from a quote BEFORE it had a job carries job_id NULL, which hid
      -- it from the guard below and let a second live invoice through. Claim it first.
      update public.documents
         set job_id = v_job.id
       where tenant_id = v_tenant and doc_type = 'invoice'
         and status <> 'void' and job_id is null
         and source_document_id in (
           select id from public.documents
            where tenant_id = v_tenant and doc_type = 'quote'
              and (id = v_q.id or id = v_q.source_document_id)
         );

      update public.jobs
         set notes         = coalesce(nullif(btrim(v_service), ''), notes),
             technician_id = coalesce(p_technician_id, technician_id),
             scheduled_at  = coalesce(p_scheduled_at, scheduled_at)
       where id = v_job.id
       returning * into v_job;

      -- Accept the revision BEFORE re-billing: convert_quote_to_invoice bills the
      -- last ACCEPTED quote, which must be this one.
      update public.documents
         set status = 'accepted', job_id = v_job.id,
             accepted_signature = coalesce(v_sig, accepted_signature)
       where id = v_q.id;

      -- The job is already billed? Then this accept IS a re-price: retire the old
      -- bill, carry any deposit forward, and bill the revision — one transaction.
      select * into v_old from public.documents
       where tenant_id = v_tenant and job_id = v_job.id
         and doc_type = 'invoice' and status <> 'void'
       for update;
      if found and v_old.source_document_id is distinct from v_q.id then
        if v_old.status = 'draft' then
          -- Never issued: no number, no money — it simply goes.
          delete from public.document_lines where document_id = v_old.id;
          delete from public.documents where id = v_old.id;
        else
          -- Transfer the deposit OFF the old bill: paired ledger rows booked to no
          -- session — no drawer or Z impact, the money already counted on the day
          -- it was taken. The OUT mirror marks each payment reversed, so the old
          -- bill recomputes to unpaid and nothing can double-collect it.
          for v_pay in
            select * from public.payments p
             where p.tenant_id = v_tenant and p.document_id = v_old.id
               and p.amount > 0 and p.reverses_payment_id is null
               and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
          loop
            insert into public.payments
              (tenant_id, document_id, method, amount, external_ref, reverses_payment_id,
               cash_session_id, booked_session_id, received_by)
            values
              (v_tenant, v_old.id, v_pay.method, -v_pay.amount,
               'moved to revised bill', v_pay.id, v_pay.cash_session_id, null, v_actor);
            v_carried := v_carried + v_pay.amount;
          end loop;
          update public.documents
             set amount_paid = 0,
                 status = 'issued'::doc_status
           where id = v_old.id;

          -- Void the now-unpaid old bill (inline: this path is open to the cashier
          -- who takes the signature, unlike owner/manager-only void_document) and
          -- put its stocked items back — the revision's issue will draw them again.
          insert into public.stock_movements
            (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, ref_line_id, created_by, note)
          select tenant_id, product_id, location_id, -qty, unit_cost, 'invoice', ref_id, null, v_actor, 'void reversal (re-priced)'
          from public.stock_movements
          where tenant_id = v_tenant and ref_type = 'invoice' and ref_id = v_old.id and ref_line_id is not null;
          update public.documents
             set status = 'void', voided_at = now(),
                 void_reason = 'Re-priced — replaced by revision ' || coalesce(v_q.number, '')
           where id = v_old.id;
          insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
          values (v_tenant, v_actor, 'document_voided', 'document', v_old.id,
                  jsonb_build_object('reason', 're-priced by revision ' || coalesce(v_q.number, ''),
                                     'replaced_by_quote', v_q.id));
        end if;

        -- Bill the revision NOW and land the deposit on it, so checkout shows the
        -- honest balance the moment the customer signs.
        select * into v_new_inv from public.convert_quote_to_invoice(v_q.id);
        if v_new_inv.status = 'draft' then
          select * into v_new_inv from public.issue_document(v_new_inv.id, null, 'reprice:' || v_q.id, null);
        end if;
        if v_carried > 0 then
          -- A standing positive cash row must satisfy the tender arithmetic check;
          -- a transfer changes no hands, so tendered = amount, change 0.
          insert into public.payments
            (tenant_id, document_id, method, amount, tendered, change_given, external_ref,
             reverses_payment_id, cash_session_id, booked_session_id, received_by)
          select v_tenant, v_new_inv.id, p.method, p.amount,
                 case when p.method = 'cash' then p.amount end,
                 case when p.method = 'cash' then 0::numeric end,
                 'deposit from ' || coalesce(v_old.number, 'previous bill'),
                 null, p.cash_session_id, null, p.received_by
            from public.payments p
           where p.tenant_id = v_tenant and p.document_id = v_old.id
             and p.amount > 0 and p.reverses_payment_id is null;
          update public.documents d
             set amount_paid = sub.paid,
                 status = (case when sub.paid >= d.total_incl then 'paid' else 'partly_paid' end)::doc_status
            from (select coalesce(sum(amount),0) paid from public.payments where document_id = v_new_inv.id) sub
           where d.id = v_new_inv.id;
        end if;
      end if;

      insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
      values (v_tenant, v_actor, 'quote_revision_accepted', 'document', v_q.id,
              jsonb_build_object('job_id', v_job.id, 'quote_number', v_q.number,
                                 'replaces', v_q.source_document_id, 'signed', v_sig is not null,
                                 'rebilled', v_new_inv.number, 'deposit_carried', v_carried));

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
     coalesce(app.intake_for_vehicle(v_q.intake, v_q.vehicle_id)->'markers', '[]'::jsonb),
     v_q.id, v_actor)
  returning * into v_job;

  -- Same claim for a first accept: the builder's "Bill now" can have raised an invoice
  -- from this quote before any job existed.
  update public.documents
     set job_id = v_job.id
   where tenant_id = v_tenant and doc_type = 'invoice'
     and status <> 'void' and job_id is null
     and source_document_id = v_q.id;

  for r in select value from jsonb_array_elements(
             coalesce(app.intake_for_vehicle(v_q.intake, v_q.vehicle_id)->'photos', '[]'::jsonb)) loop
    if nullif(r->>'path', '') is not null then
      insert into public.job_photos (tenant_id, job_id, storage_path, caption, phase, created_by)
      values (v_tenant, v_job.id, r->>'path', nullif(r->>'caption', ''), 'before', v_actor);
    end if;
  end loop;

  update public.documents
     set status = 'accepted', job_id = v_job.id,
         accepted_signature = coalesce(v_sig, accepted_signature)
   where id = v_q.id;

  insert into public.document_jobs (tenant_id, document_id, job_id)
  values (v_tenant, v_q.id, v_job.id) on conflict do nothing;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'quote_converted_to_job', 'document', v_q.id,
          jsonb_build_object('job_id', v_job.id, 'quote_number', v_q.number,
                             'signed', v_sig is not null));

  return v_job;
end $function$
;

-- ─── 12. No stale overloads, no anon grant ───────────────────────────────────
-- create or replace at a CHANGED argument list adds an overload and leaves the
-- old function live for anything that still matches it. Every function this
-- migration touched kept its signature — assert it, rather than trusting it.
do $$
declare n int; fn text;
begin
  foreach fn in array array['save_draft','convert_quote_to_job','convert_quote_to_jobs',
                            'convert_quote_to_invoice','create_job_from_document',
                            'create_intake_quote','create_intake_quote_cars'] loop
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn;
    if n <> 1 then raise exception '% has % definitions — a stale overload is live', fn, n; end if;
  end loop;

  -- The public-schema default ACL hands anon a grant on every new table; revoking
  -- "public" does not take it away. Assert the junction is not readable by anon.
  if has_table_privilege('anon', 'public.document_jobs', 'select') then
    raise exception 'anon can read document_jobs';
  end if;
end $$;
