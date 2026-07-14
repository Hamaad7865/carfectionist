-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a job's bill is the quote the customer already signed
--
-- create_document_from_job invented a single blank line ("Service work", Rs 0) from
-- the job's notes and left a human to retype the price — even when the job was born
-- of an accepted, signed, priced quote sitting one foreign key away. The operator
-- rekeyed what the customer had already agreed to, and the invoice lost the product
-- link with it: no product_id, so no stock movement, no sales history, and any typo
-- became the bill.
--
-- The correct path already existed. convert_quote_to_invoice copies every line, the
-- order discount and the lineage, and is idempotent from either direction (it returns
-- the live invoice whether it was raised from the quote or from the quote's job). So
-- a quote-born job now delegates to it rather than keeping a second, worse
-- implementation alive beside it.
--
-- A job with NO quote — a walk-in someone just books and bills — keeps the editable
-- ad-hoc line. There is nothing to copy, and typing the price is the whole point.
--
-- This is the LIVE body, unchanged, plus exactly one branch.
-- ═══════════════════════════════════════════════════════════════════════════

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
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');
  if p_doc_type not in ('quote','invoice') then
    raise exception 'a job document must be a quote or invoice, not %', p_doc_type;
  end if;

  select * into v_job from public.jobs where id = p_job_id and tenant_id = v_tenant;
  if not found then raise exception 'job not found'; end if;

  -- The bill for a quoted job IS the quote. Hand the whole thing over — lines, prices,
  -- order discount, lineage — instead of asking anyone to type it again. Idempotent:
  -- convert_quote_to_invoice returns the invoice that already exists, from either path.
  if p_doc_type = 'invoice' and v_job.source_quote_id is not null then
    return public.convert_quote_to_invoice(v_job.source_quote_id);
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
