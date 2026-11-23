-- ═══════════════════════════════════════════════════════════════════════════
-- A quote split per company is ONE agreement (owner decision 2026-11-23, "option A").
--
-- A two-company shop (tyre centre) sends a visit as one quote per issuing company, linked by
-- documents.checkout_group_id (issue_checkout, 20261123000010). Until now accept_quote,
-- convert_quote_to_job and convert_quote_to_invoice each acted on the ONE quote they were given:
-- signing the tyre quote opened a job and a bill for the tyres only, and the service company's
-- quote was left behind. From here, for a split pair only:
--
--   · accept_quote(either)             → every quote of the visit is accepted;
--   · convert_quote_to_job(either)     → ONE job, opened from the visit's first quote (the group
--                                         id), and every quote of the visit is accepted onto it;
--   · convert_quote_to_invoice(either) → ONE draft bill holding every company's lines, each line
--                                         keeping its company, with each quote's own discount
--                                         carried as that company's discount
--                                         (template_overrides.companyDiscounts). Issuing it goes
--                                         through issue_checkout, which bills each company
--                                         separately, as a checkout always has.
--
-- A quote with no checkout_group_id (every one-company shop, and a two-company shop's
-- one-company quote) takes exactly the path it took before: the splices add one line at the
-- top of each body that returns nothing for it.
--
-- Additive: three helpers in app, and one line spliced onto each LIVE function body
-- (the 20261122000010 method), so nothing else in those bodies can be reverted by a stale copy.
-- ═══════════════════════════════════════════════════════════════════════════

-- The other quotes of p_quote's split visit. Empty for a quote that was never split, and empty
-- while a visit is already being walked (app.quote_pair_walk) — that is what stops the walk
-- below from re-entering itself when it calls the public functions for each quote.
create or replace function app.quote_pair_siblings(p_quote uuid)
returns setof uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select d.id
    from public.documents q
    join public.documents d
      on d.tenant_id = q.tenant_id and d.checkout_group_id = q.checkout_group_id
     and d.doc_type = 'quote' and d.id <> q.id and d.status <> 'void'
    left join public.legal_entities e on e.id = d.legal_entity_id
   where q.id = p_quote and q.doc_type = 'quote' and q.checkout_group_id is not null
     and q.tenant_id = app.current_tenant_id()
     and coalesce(current_setting('app.quote_pair_walk', true), '') <> 'on'
   order by e.sort_order nulls first, d.legal_entity_id, d.id
$$;

-- accept_quote, for the rest of the visit: the signature and the agreement cover every quote.
create or replace function app.accept_quote_siblings(p_quote uuid, p_signature jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_ids uuid[] := array(select app.quote_pair_siblings(p_quote));
begin
  if cardinality(v_ids) = 0 then return; end if;
  perform set_config('app.quote_pair_walk', 'on', true);
  perform public.accept_quote(x, p_signature) from unnest(v_ids) x;
  perform set_config('app.quote_pair_walk', '', true);
end $$;

-- convert_quote_to_job, for a split visit: one job for the car, every quote agreed onto it.
-- Returns NULL for a quote that was never split (the caller then carries on as before).
create or replace function app.quote_pair_job(
  p_quote uuid, p_technician_id uuid, p_scheduled_at timestamptz, p_signature jsonb
) returns public.jobs language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_ids    uuid[] := array(select app.quote_pair_siblings(p_quote));
  v_all    uuid[];
  v_first  uuid;
  v_job    public.jobs;
begin
  if cardinality(v_ids) = 0 then return null; end if;
  v_all := p_quote || v_ids;

  perform set_config('app.quote_pair_walk', 'on', true);

  -- The visit already has its job (opened from either quote): hand it back — the original's
  -- idempotency, widened to the visit.
  select j.* into v_job from public.jobs j
   where j.tenant_id = v_tenant and j.source_quote_id = any(v_all) and j.status <> 'cancelled'
   order by j.created_at, j.id limit 1;

  if v_job.id is null then
    -- Opened from the visit's first quote: the group id IS the first company's quote.
    select checkout_group_id into v_first from public.documents where id = p_quote;
    if v_first is null or not (v_first = any(v_all)) then v_first := p_quote; end if;
    select * into v_job from public.convert_quote_to_job(v_first, p_technician_id, p_scheduled_at, p_signature);
  end if;

  -- Every other quote of the visit: agreed (same gate as accept_quote — a declined or void one
  -- refuses the whole signature), and on the same job.
  perform public.accept_quote(x, p_signature) from unnest(v_all) x where x <> v_job.source_quote_id;
  update public.documents set job_id = v_job.id
   where tenant_id = v_tenant and id = any(v_all) and job_id is distinct from v_job.id;
  insert into public.document_jobs (tenant_id, document_id, job_id)
  select v_tenant, x, v_job.id from unnest(v_all) x
  on conflict do nothing;
  -- A bill raised from any quote of the visit before the job existed belongs to it too.
  update public.documents set job_id = v_job.id
   where tenant_id = v_tenant and doc_type = 'invoice' and status <> 'void' and job_id is null
     and source_document_id = any(v_all);

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, app.current_app_user_id(), 'quote_pair_converted_to_job', 'document', p_quote,
          jsonb_build_object('job_id', v_job.id, 'quotes', to_jsonb(v_all), 'signed', p_signature is not null));

  perform set_config('app.quote_pair_walk', '', true);
  return v_job;
end $$;

-- convert_quote_to_invoice, for a split visit: ONE draft bill with every company's lines.
-- Returns NULL for a quote that was never split (the caller then carries on as before).
create or replace function app.quote_pair_invoice(p_quote uuid)
returns public.documents language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_ids    uuid[] := array(select app.quote_pair_siblings(p_quote));
  v_all    uuid[];
  v_first  public.documents;
  v_bad    public.documents;
  v_inv    public.documents;
  v_job    uuid;
  v_disc   jsonb;
  v_new    uuid := gen_random_uuid();
  x        uuid;
begin
  if cardinality(v_ids) = 0 then return null; end if;
  v_all := p_quote || v_ids;

  -- Every quote of the visit has to be billable, or none is: half a visit is not a bill.
  select * into v_bad from public.documents
   where id = any(v_all) and status not in ('issued', 'accepted') order by id limit 1;
  if found then
    raise exception 'cannot invoice this visit: quote % is %', coalesce(v_bad.number, 'draft'), v_bad.status;
  end if;

  select * into v_first from public.documents d
   where d.id = (select checkout_group_id from public.documents where id = p_quote) and d.id = any(v_all);
  if not found then select * into v_first from public.documents where id = p_quote; end if;
  select max(job_id::text)::uuid into v_job from public.documents where id = any(v_all) and job_id is not null;

  -- Idempotent: the visit's live bill — before it is issued the one draft, after it the bills
  -- issue_checkout made of it (each keeps the source quote and the job).
  select * into v_inv from public.documents
   where tenant_id = v_tenant and doc_type = 'invoice' and status <> 'void'
     and (source_document_id = any(v_all) or (v_job is not null and job_id = v_job))
   order by (id = coalesce(checkout_group_id, id)) desc, created_at, id
   limit 1;
  if found then return v_inv; end if;

  foreach x in array v_all loop
    perform app.discard_superseded_drafts(x);
    perform app.assert_no_superseded_bill(x, 'The quotation behind this bill');
  end loop;

  -- Each quote's own discount becomes its company's discount on the bill, in the shape the
  -- builder stores (amount in cents) and issueAcrossCompanies hands to issue_checkout.
  select coalesce(jsonb_object_agg(q.legal_entity_id::text, jsonb_build_object(
           'kind', q.discount_kind,
           'value', case when q.discount_kind = 'amount' then round(q.discount_value * 100) else q.discount_value end,
           'reason', q.discount_reason)), '{}'::jsonb)
    into v_disc
    from public.documents q
   where q.id = any(v_all) and q.discount_kind is not null and coalesce(q.discount_value, 0) > 0
     and q.legal_entity_id is not null;

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, discount_kind, discount_value, created_by)
  values
    (v_new, v_tenant, 'invoice', 'draft', v_first.customer_id, v_first.vehicle_id, v_job, v_first.id,
     v_first.template_id, coalesce(v_first.template_overrides, '{}'::jsonb) || jsonb_build_object('companyDiscounts', v_disc),
     v_first.currency, v_first.origin, null, 0, app.current_app_user_id());

  -- Every company's lines, in company order, each keeping the company that sells it.
  insert into public.document_lines
    (tenant_id, document_id, product_id, vehicle_id, title, description, description_richtext, unit_label,
     qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind,
     price_includes_vat, legal_entity_id)
  select v_tenant, v_new, l.product_id, l.vehicle_id, l.title, l.description, l.description_richtext, l.unit_label,
         l.qty, l.unit_price, l.discount_pct, l.discount_kind, l.discount_amount, l.vat_rate,
         (row_number() over (order by e.sort_order nulls first, q.legal_entity_id, l.sort_order, l.id))::int - 1,
         l.line_kind, l.price_includes_vat, coalesce(l.legal_entity_id, q.legal_entity_id)
    from public.document_lines l
    join public.documents q on q.id = l.document_id
    left join public.legal_entities e on e.id = q.legal_entity_id
   where l.document_id = any(v_all);

  insert into public.document_jobs (tenant_id, document_id, job_id)
  select v_tenant, v_new, j.id from public.jobs j
   where j.tenant_id = v_tenant and (j.source_quote_id = any(v_all) or j.id = v_job)
  on conflict do nothing;

  perform set_config('app.quote_pair_walk', 'on', true);
  update public.documents set status = 'accepted' where id = any(v_all) and status = 'issued';
  perform set_config('app.quote_pair_walk', '', true);

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, app.current_app_user_id(), 'quote_pair_converted_to_invoice', 'document', p_quote,
          jsonb_build_object('invoice_id', v_new, 'quotes', to_jsonb(v_all)));

  select * into v_inv from public.documents where id = v_new;
  return v_inv;
end $$;

-- Internal: reached only through the three public functions below.
revoke all on function app.quote_pair_siblings(uuid) from public, anon, authenticated;
revoke all on function app.accept_quote_siblings(uuid, jsonb) from public, anon, authenticated;
revoke all on function app.quote_pair_job(uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function app.quote_pair_invoice(uuid) from public, anon, authenticated;

-- ── one line on each LIVE body (same splice as 20261122000010) ─────────────────
create or replace function pg_temp.splice(p_schema text, p_name text, p_marker text, p_pairs text[])
returns void language plpgsql as $$
declare
  v_def text; v_n int; i int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = p_schema and p.proname = p_name;
  if v_n <> 1 then raise exception '%.% has % definitions, not 1', p_schema, p_name, v_n; end if;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = p_schema and p.proname = p_name;
  if position(E'\r' in v_def) > 0 then raise exception '%.%: CRLF body', p_schema, p_name; end if;
  if position(p_marker in v_def) > 0 then return; end if;
  i := 1;
  while i < array_length(p_pairs, 1) loop
    v_n := (length(v_def) - length(replace(v_def, p_pairs[i], ''))) / length(p_pairs[i]);
    if v_n <> 1 then
      raise exception '%.%: anchor % matches % times, not 1 — nothing was changed: %', p_schema, p_name, (i + 1) / 2, v_n, p_pairs[i];
    end if;
    v_def := replace(v_def, p_pairs[i], p_pairs[i + 1]);
    i := i + 2;
  end loop;
  if position(p_marker in v_def) = 0 then raise exception '%.%: marker missing after splice', p_schema, p_name; end if;
  execute v_def;
end $$;

-- accept_quote: having accepted this quote, accept the rest of its visit.
select pg_temp.splice('public', 'accept_quote', 'app.accept_quote_siblings', array[
  $s$  if v_q.id is null then select * into v_q from public.documents where id = p_quote_id; end if;$s$,
  $s$  if v_q.id is null then select * into v_q from public.documents where id = p_quote_id; end if;
  perform app.accept_quote_siblings(v_q.id, p_signature); -- a split visit is one agreement (20261126000010)$s$
]);

-- convert_quote_to_job: a split visit opens ONE job, before anything else is decided.
select pg_temp.splice('public', 'convert_quote_to_job', 'app.quote_pair_job', array[
  $s$  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;$s$,
  $s$  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;
  select * into v_job from app.quote_pair_job(v_q.id, p_technician_id, p_scheduled_at, p_signature); -- split visit (20261126000010)
  if v_job.id is not null then return v_job; end if;$s$
]);

-- convert_quote_to_invoice: a split visit is billed as ONE draft holding every company's lines.
select pg_temp.splice('public', 'convert_quote_to_invoice', 'app.quote_pair_invoice', array[
  $s$  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;$s$,
  $s$  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;
  select * into v_inv from app.quote_pair_invoice(v_q.id); -- split visit (20261126000010)
  if v_inv.id is not null then return v_inv; end if;$s$
]);

-- The splices are CREATE OR REPLACE on an unchanged signature: no stale overload, grants kept.
-- Assert both, so a later edit to this file cannot quietly break either.
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('accept_quote', 'convert_quote_to_job', 'convert_quote_to_invoice');
  if v_n <> 3 then raise exception 'expected one definition each of the three quote functions, found %', v_n; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'app' and p.proname in ('quote_pair_siblings', 'accept_quote_siblings', 'quote_pair_job', 'quote_pair_invoice')
                and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) then
    raise exception 'a quote-pair helper is callable by anon/authenticated';
  end if;
end $$;
