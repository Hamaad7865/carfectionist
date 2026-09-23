-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — revising a quote updates the quote itself
--
-- Owner decision (2026-09-23): pressing Revise must reopen the CURRENT quote for
-- editing — same row, same number — instead of forking a new draft and leaving
-- the old one behind. Two rows for one negotiation meant two prices on the
-- working list and no way to tell which one stood.
--
-- WHAT CHANGES
--   • revise_quote no longer inserts a new document. A draft comes straight back
--     (revising a draft used to fork a second draft beside it); an issued or
--     accepted quote is un-signed and handed back on the same id and number, so
--     the builder can edit it in place. Declined / expired / void quotes refuse.
--   • save_draft learns the same rule: quotes in issued/accepted status accept
--     line edits now (invoices and credit notes stay fenced — the fiscal lock
--     never moved). Any edit to a non-draft quote clears its acceptance
--     signature and demotes accepted back to issued: the old price was agreed,
--     the new one has not been yet.
--   • The money guards move with the behaviour, not against it: a quote with a
--     live bill standing (its own invoice, its job's invoice, or a superseded
--     bill on its line) still refuses, and so does one whose job is delivered.
--     The price underneath an issued bill or finished job is not ours to move.
--
-- WHAT DOES NOT CHANGE
--   • Numbers: the row keeps its number; issue_document is never re-run on it,
--     so the gapless series is untouched (and the number-immutable trigger is
--     never tripped — we simply never write the column).
--   • History: past forks keep their links; nothing is backfilled or deleted.
--     No new links are written from here on, so the retirement predicates just
--     go quiet on new work.
--   • save_draft's body below is the LIVE definition read out of the database
--     with pg_get_functiondef (car check, discount_reason, header-car follow and
--     all), with only the issued-document gate relaxed for quotes. Rebuilding it
--     from an older migration file would silently drop those splices.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. revise_quote reopens the same quote ─────────────────────────────────
create or replace function public.revise_quote(p_quote_id uuid)
returns public.documents
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_q   public.documents;
  v_rev public.documents;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'only quotes can be revised'; end if;

  -- A draft is already editable: hand it back instead of forking a second draft
  -- beside it (the duplicate the shop kept tripping over).
  if v_q.status = 'draft' then
    return v_q;
  end if;

  if v_q.status in ('declined', 'expired', 'void') then
    raise exception 'this quotation is % and can no longer be revised', v_q.status;
  end if;

  -- From 20260909000010: a quote already billed on a bill no job owns is past
  -- negotiating. Dropping this line re-opens the hole INV-0204 came through.
  perform app.assert_no_superseded_bill(v_q.id, 'This quotation');

  -- The price underneath an issued bill is not ours to move: void or credit it
  -- first (the bill's own screen says which), then revise.
  if exists (
    select 1 from public.documents
     where doc_type = 'invoice' and tenant_id = v_tenant and status <> 'void'
       and ( source_document_id = v_q.id
             or (v_q.job_id is not null and job_id = v_q.job_id) )
  ) then
    raise exception 'this quote has already been billed — void or credit that bill first, then revise';
  end if;

  -- Finished work stays finished: a delivered job's price is history.
  if v_q.job_id is not null and exists (
    select 1 from public.jobs
     where id = v_q.job_id and tenant_id = v_tenant and status = 'delivered'
  ) then
    raise exception 'this quote''s job is already delivered — its price is final';
  end if;

  -- Un-sign it: the customer agreed the OLD price, not whatever is typed next.
  -- Same row, same number, same job link; the builder edits it in place and the
  -- customer signs (or the counter bills) the new figure.
  update public.documents set
    status             = case when v_q.status = 'accepted' then 'issued' else status end,
    accepted_signature = null,
    revision           = revision + 1
   where id = v_q.id
  returning * into v_rev;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, app.current_app_user_id(), 'quote_revised_in_place', 'document', v_q.id,
          jsonb_build_object('number', v_q.number, 'was_status', v_q.status));

  return v_rev;
end $function$;

-- ─── 2. save_draft lets a non-draft QUOTE move (bills stay fenced) ──────────
-- Live body, one gate changed. Every other line is pg_get_functiondef-verbatim.
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
    -- Dead quotes stay dead.
    if v_doc.doc_type = 'quote' and v_doc.status in ('declined', 'expired', 'void') then
      raise exception 'this quotation is % and can no longer be edited', v_doc.status;
    end if;
    if v_doc.doc_type = 'quote' and v_doc.status in ('issued', 'accepted') then
      -- Editing the price the customer was shown: the same money guards as
      -- revise_quote, because this is the same act through the builder's door.
      perform app.assert_no_superseded_bill(v_doc.id, 'This quotation');
      if exists (
        select 1 from public.documents
         where doc_type = 'invoice' and tenant_id = v_tenant and status <> 'void'
           and ( source_document_id = v_doc.id
                 or (v_doc.job_id is not null and job_id = v_doc.job_id) )
      ) then
        raise exception 'this quote has already been billed — void or credit that bill first, then edit';
      end if;
      if v_doc.job_id is not null and exists (
        select 1 from public.jobs
         where id = v_doc.job_id and tenant_id = v_tenant and status = 'delivered'
      ) then
        raise exception 'this quote''s job is already delivered — its price is final';
      end if;
    elsif v_doc.status <> 'draft' then
      raise exception 'cannot edit an issued document';
    end if;
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
      -- An edit un-signs the deal: the customer agreed the old figure, not this
      -- one. An accepted quote steps back to issued on the same number.
      status             = case when v_doc.doc_type = 'quote' and v_doc.status = 'accepted' then 'issued' else status end,
      accepted_signature = case when v_doc.doc_type = 'quote' and v_doc.status <> 'draft' then null else accepted_signature end,
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

-- ─── prove the seam moved and nothing else did ──────────────────────────────
do $$
declare
  v_rev text;
  v_save text;
begin
  select pg_get_functiondef('public.revise_quote(uuid)'::regprocedure) into v_rev;
  if position('quote_revised_in_place' in v_rev) = 0 then
    raise exception 'revise_quote does not reopen the quote in place';
  end if;
  if position('revision_of' in v_rev) <> 0 then
    raise exception 'revise_quote still forks a revision row';
  end if;
  if position('assert_no_superseded_bill' in v_rev) = 0 then
    raise exception 'revise_quote lost the superseded-bill guard';
  end if;

  select pg_get_functiondef('public.save_draft(jsonb,jsonb,integer)'::regprocedure) into v_save;
  if position('can no longer be edited' in v_save) = 0 then
    raise exception 'save_draft lost the dead-quote guard';
  end if;
  if position('a line names a car that is not this customer' in v_save) = 0 then
    raise exception 'save_draft lost the line-car check';
  end if;
  if position('discount_reason' in v_save) = 0 then
    raise exception 'save_draft lost discount_reason';
  end if;
  if position('app.document_cars' in v_save) = 0 then
    raise exception 'save_draft lost the header-car follow';
  end if;
  if position('price_includes_vat' in v_save) = 0 then
    raise exception 'save_draft lost price_includes_vat';
  end if;
  raise notice 'revise reopens the same quote; save_draft keeps every splice and lets quotes move';
end $$;

notify pgrst, 'reload schema';
