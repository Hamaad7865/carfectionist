-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — whoever asks, the answer is the price the customer signed last
--
-- The previous migration taught create_document_from_job to price a job from the newest
-- accepted quote. But the TABLET never calls it: JobsViewModel hands
-- convert_quote_to_invoice the job's source_quote_id directly — and that column is
-- deliberately immutable, so it always names the FIRST quote. Marking a job ready on the
-- tablet auto-raises the bill, so a customer who haggled Rs 11,500 down to Rs 4,600 and
-- signed for it would be invoiced Rs 11,500, with nobody having chosen to do it. The
-- reverse — an upsell agreed at Rs 20,000 billed at the original Rs 10,000 — costs the
-- shop instead. Worse, it is self-sealing: convert_quote_to_invoice matches an existing
-- invoice by job_id, so the correct path afterwards just hands the wrong bill back.
--
-- Putting the rule in one client and not the other was the mistake. It belongs in the
-- database, at the single point every path goes through: convert_quote_to_invoice now
-- re-resolves whatever quote it is given to the one the customer actually signed last for
-- that job. Old tablets, new tablets, the web's Convert button and create_document_from_job
-- then all converge on the same figure, because none of them gets to decide it.
--
-- Also closed here, all found by adversarial review of the change above:
--   · a revision accepted against a CANCELLED job buried the work on a dead card that no
--     UI can move (jobs_guard has no transition out of 'cancelled');
--   · an invoice raised from a quote before it had a job kept job_id NULL, so the
--     "already invoiced" guard missed it and a second live invoice could be raised;
--   · revising the same quote twice forked two sibling revisions, and the bill was then
--     decided by which was CREATED last rather than which was SIGNED last.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the single authority on price ───────────────────────────────────────────
create or replace function public.convert_quote_to_invoice(p_quote_id uuid)
returns documents
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  -- Whatever quote the caller named, bill the one the customer signed LAST for this job.
  -- Accepting a quote issues it, so quote numbers run in the order they were signed and
  -- the highest belongs to the latest agreement. A quote with no job (the builder's "Bill
  -- now") has nothing to re-resolve to and stands as itself.
  if v_q.job_id is not null then
    select * into v_inv from public.documents
     where tenant_id = v_tenant and job_id = v_q.job_id
       and doc_type = 'quote' and status = 'accepted'
     order by number desc nulls last, created_at desc
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
  -- from THIS quote (source_document_id) or from the quote's JOB (job_id) — the
  -- two paths that otherwise each mint their own invoice for the same sale.
  select * into v_inv from public.documents
   where doc_type = 'invoice' and tenant_id = v_tenant and status <> 'void'
     and ( source_document_id = v_q.id
           or (v_q.job_id is not null and job_id = v_q.job_id) )
   order by created_at
   limit 1;
  if found then return v_inv; end if;

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, discount_kind, discount_value, created_by)
  values
    (v_new, v_tenant, 'invoice', 'draft', v_q.customer_id, v_q.vehicle_id, v_q.job_id, v_q.id,
     v_q.template_id, v_q.template_overrides, v_q.currency, v_q.origin, v_q.discount_kind, v_q.discount_value, app.current_app_user_id())
  returning * into v_inv;

  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order)
  select v_tenant, v_new, product_id, title, description, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order
  from public.document_lines where document_id = v_q.id;

  update public.documents set status = 'accepted' where id = v_q.id and status = 'issued';
  select * into v_inv from public.documents where id = v_new;
  return v_inv;
end $function$;


-- ── one live revision at a time ─────────────────────────────────────────────
create or replace function public.revise_quote(p_quote_id uuid)
returns documents
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order)
  select v_tenant, v_new, product_id, title, description, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order
  from public.document_lines where document_id = v_q.id;

  select * into v_rev from public.documents where id = v_new;
  return v_rev;
end $function$;


-- ── accepting a revision ────────────────────────────────────────────────────
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

  -- Same claim for a first accept: the builder's "Bill now" can have raised an invoice
  -- from this quote before any job existed.
  update public.documents
     set job_id = v_job.id
   where tenant_id = v_tenant and doc_type = 'invoice'
     and status <> 'void' and job_id is null
     and source_document_id = v_q.id;

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


-- ── billing a job ───────────────────────────────────────────────────────────
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
  -- and the lineage — not a blank line someone has to retype. convert_quote_to_invoice
  -- settles WHICH quote (the one signed last); handing it any quote of this job is enough.
  if p_doc_type = 'invoice' then
    select id into v_quote
      from public.documents
     where tenant_id = v_tenant and job_id = v_job.id
       and doc_type = 'quote' and status = 'accepted'
     order by number desc nulls last, created_at desc
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

  -- No quote to inherit from: one editable ad-hoc service line from the job's service
  -- text (price left 0 for the operator to set).
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
