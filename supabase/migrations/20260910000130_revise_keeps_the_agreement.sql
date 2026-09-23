-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — revising keeps the agreement
--
-- Owner decision (2026-09-23, refinement of 20260910000110/120): revising a
-- quote is a correction to the SAME agreement, not a new one. The first cut
-- un-signed the quote on save (accepted → issued, signature cleared) and
-- pushed the operator back through the signature ceremony. The shop does not
-- work that way: a revised figure keeps everything the quote had — status,
-- signature, booking time and deposit — and the edit is simply saved.
--
-- WHAT CHANGES (save_draft only; revise_quote is untouched)
--   • A non-draft quote save no longer demotes accepted → issued and no longer
--     clears accepted_signature. Booking (book_for_at / deposit_due) was never
--     written by save_draft and stays as it was.
--   • The amend audit row now carries the old and new totals, so the trail
--     still answers "what did the customer sign, and what did it become, and
--     who changed it" — the signature image stays, the ledger tells the rest.
--
-- WHAT DOES NOT CHANGE
--   • Every fence from 20260910000120 stays: live-bill guard (draft bills
--     included, fully-credited retired), delivered-job refusal, dead-quote
--     refusal, doc_type/customer/job freeze, allowance check, line-car check,
--     header-car follow, totals recompute. Only the un-signing goes away.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── save_draft: an amend keeps status and signature ───────────────────────
-- 20260910000120 body with the two un-sign lines dropped and a richer audit.
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
  v_amend    boolean := false;
  v_was_total numeric;
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
      v_amend := true;
      v_was_total := v_doc.total_incl;
      -- The same money guards as revise_quote, because this is the same act
      -- through the builder's door.
      perform app.assert_no_superseded_bill(v_doc.id, 'This quotation');
      perform app.assert_no_live_bill(v_doc.id, v_doc.job_id, 'edit');
      if v_doc.job_id is not null and exists (
        select 1 from public.jobs
         where id = v_doc.job_id and tenant_id = v_tenant and status = 'delivered'
      ) then
        raise exception 'this quote''s job is already delivered — its price is final';
      end if;
      -- Type, customer and job are frozen once issued. Lines, discount,
      -- comment, template and dates stay editable — that is what revising means.
      if p_doc ? 'doc_type' and nullif(p_doc->>'doc_type','') is not null
         and (p_doc->>'doc_type')::doc_type is distinct from v_doc.doc_type then
        raise exception 'cannot change the type of an issued quote';
      end if;
      if v_customer is not null and v_customer is distinct from v_doc.customer_id then
        raise exception 'cannot change the customer on an issued quote — start a new quotation instead';
      end if;
      if v_job is not null and v_job is distinct from v_doc.job_id then
        raise exception 'cannot move an issued quote to another job';
      end if;
    elsif v_doc.status <> 'draft' then
      raise exception 'cannot edit an issued document';
    end if;
    if p_expected_rev is not null and v_doc.revision <> p_expected_rev then
      raise exception 'document was modified elsewhere (rev % expected %)', v_doc.revision, p_expected_rev;
    end if;
    update public.documents set
      doc_type           = coalesce(nullif(p_doc->>'doc_type','')::doc_type, doc_type),
      customer_id        = case when v_amend then coalesce(v_customer, customer_id) else v_customer end,
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
      -- A revise keeps the agreement: status, signature and booking stay
      -- exactly as they were — only the figures move. The audit below records
      -- the change, so the trail still answers what was signed and what it
      -- became. (Nothing in this statement touches the agreement columns, and
      -- booking columns are never written by this function.)
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

  if v_amend then
    -- The owner's ceiling applies to the new figure too — no re-issue ever
    -- re-checks it. Drafts still check at issue time (the builder's
    -- save-then-ask-owner flow depends on saving first).
    perform app.assert_discount_allowed(v_id);
    -- A direct /edit save bypasses revise, so it audits itself — with the old
    -- and new totals, so the trail answers what was signed and what it became.
    insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
    values (v_tenant, app.current_app_user_id(), 'quote_edited_in_place', 'document', v_id,
            jsonb_build_object('number', v_doc.number, 'was_total', v_was_total,
                               'total', (select total_incl from public.documents where id = v_id)));
  end if;

  select * into v_doc from public.documents where id = v_id;
  return v_doc;
end $function$;

-- ─── prove the agreement stays while the fences stand ─────────────────────
do $$
declare
  v_save text;
begin
  select pg_get_functiondef('public.save_draft(jsonb,jsonb,integer)'::regprocedure) into v_save;
  if position('was_total' in v_save) = 0 then
    raise exception 'save_draft lost the amend totals audit';
  end if;
  if position('accepted_signature' in v_save) <> 0 then
    raise exception 'save_draft still rewrites the signature';
  end if;
  if position('assert_no_live_bill' in v_save) = 0 then
    raise exception 'save_draft lost the live-bill guard';
  end if;
  if position('assert_discount_allowed' in v_save) = 0 then
    raise exception 'save_draft lost the allowance check';
  end if;
  if position('cannot change the customer on an issued quote' in v_save) = 0 then
    raise exception 'save_draft lost the identity freeze';
  end if;
  if position('a line names a car that is not this customer' in v_save) = 0 then
    raise exception 'save_draft lost the line-car check';
  end if;
  if position('app.document_cars' in v_save) = 0 then
    raise exception 'save_draft lost the header-car follow';
  end if;
  raise notice 'a revise keeps the agreement; every fence still stands';
end $$;

notify pgrst, 'reload schema';
