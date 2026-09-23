-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — in-place revise, hardened (sweep of 20260910000110)
--
-- The first in-place cut reopened the quote but left five holes a live system
-- cannot carry. All found by adversarial review before any customer met them:
--
--   1. STALE BILL — a DRAFT invoice did not block quote edits. Amend a quote,
--      bill it (draft bill raised), amend the quote again: convert hands back
--      the SAME draft bill, still priced from the pre-edit lines, while the
--      quote shows the new figure. Before in-place editing this was
--      unreachable (billing accepted the quote and froze it). Any live bill
--      now blocks — draft included.
--   2. CREDITED REGRESSION — the bill check blocked on `status <> 'void'`, so
--      a fully-credited (reversed) bill still fenced the quote, where the old
--      fork design let a revision through (20260910000020: a fully-credited
--      bill is retired). A live credit note retires the bill here too;
--      partial/voided credits still block, same as that migration.
--   3. ALLOWANCE BYPASS — save_draft never called app.assert_discount_allowed
--      (only issue_document does), so raising the discount on an issued quote
--      skipped the owner's ceiling and the reason rule entirely — no re-issue
--      ever re-checked it. Non-draft quote saves now assert it, after the
--      lines land. Drafts still check at issue time, so the builder's
--      save-then-ask-owner flow is untouched.
--   4. IDENTITY REWRITE — a non-draft save could flip doc_type (an issued
--      INVOICE wearing a quote's number, no stock movement, no fiscal
--      snapshot), re-point the customer, or move the quote to another job
--      while the job link (immutable elsewhere) stayed. Type, customer and
--      job are now frozen once issued, with messages that say what to do
--      instead. Lines, discount, comment, template and dates stay editable —
--      that is what revising means.
--   5. SILENT UNSIGN — revise demoted and un-signed on press, so Revise-then-
--      Back rewrote the deal with zero edits. Revise is now side-effect-free
--      (guards + audit + the same row back); the first SAVE that lands new
--      content demotes and un-signs instead. Nothing changes until something
--      changes.
--   6. AUDIT GAP — a direct /edit save on an issued quote bypassed revise's
--      audit row. Non-draft saves now write their own.
--
-- save_draft below is the 20260910000110 body with only these splices. The
-- revise_quote body drops its data change (hole 5) and gains the bill wording
-- (holes 1–2).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── shared money rule, one place ──────────────────────────────────────────
-- A quote with a live bill standing is past negotiating — at ANY status past
-- draft, and whether the bill is a draft (edit the bill, not the quote) or
-- issued/paid (void or credit it first). A fully-credited bill is retired
-- business (20260910000020), not a standing one.
create or replace function app.assert_no_live_bill(p_quote_id uuid, p_job_id uuid, p_verb text)
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $function$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if exists (
    select 1 from public.documents inv
     where inv.doc_type = 'invoice' and inv.tenant_id = v_tenant and inv.status = 'draft'
       and ( inv.source_document_id = p_quote_id
             or (p_job_id is not null and inv.job_id = p_job_id) )
       and not exists (
         select 1 from public.documents cn
          where cn.tenant_id = v_tenant and cn.doc_type = 'credit_note'
            and cn.status <> 'void' and cn.source_document_id = inv.id
       )
  ) then
    raise exception 'a draft bill is already raised from this quote — edit the bill itself, not the quote';
  end if;

  if exists (
    select 1 from public.documents inv
     where inv.doc_type = 'invoice' and inv.tenant_id = v_tenant and inv.status <> 'void' and inv.status <> 'draft'
       and ( inv.source_document_id = p_quote_id
             or (p_job_id is not null and inv.job_id = p_job_id) )
       and not exists (
         select 1 from public.documents cn
          where cn.tenant_id = v_tenant and cn.doc_type = 'credit_note'
            and cn.status <> 'void' and cn.source_document_id = inv.id
       )
  ) then
    raise exception 'this quote has already been billed — void or credit that bill first, then %', p_verb;
  end if;
end $function$;

-- ─── 1. revise_quote: guards + audit, no data change ───────────────────────
create or replace function public.revise_quote(p_quote_id uuid)
returns public.documents
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_q   public.documents;
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

  -- Holes 1–2: any live bill fences the quote; a fully-credited one does not.
  perform app.assert_no_live_bill(v_q.id, v_q.job_id, 'revise');

  -- Finished work stays finished: a delivered job's price is history.
  if v_q.job_id is not null and exists (
    select 1 from public.jobs
     where id = v_q.job_id and tenant_id = v_tenant and status = 'delivered'
  ) then
    raise exception 'this quote''s job is already delivered — its price is final';
  end if;

  -- Hole 5: reopening changes nothing by itself — same row, same number, same
  -- signature. The first save that lands new content un-signs it (save_draft).
  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, app.current_app_user_id(), 'quote_revised_in_place', 'document', v_q.id,
          jsonb_build_object('number', v_q.number, 'was_status', v_q.status));

  return v_q;
end $function$;

-- ─── 2. save_draft: quotes may move past draft, fenced ─────────────────────
-- 20260910000110 body plus holes 1–4 and 6. Drafts behave exactly as before.
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
      -- Holes 1–2: the same money guards as revise_quote, because this is the
      -- same act through the builder's door.
      perform app.assert_no_superseded_bill(v_doc.id, 'This quotation');
      perform app.assert_no_live_bill(v_doc.id, v_doc.job_id, 'edit');
      if v_doc.job_id is not null and exists (
        select 1 from public.jobs
         where id = v_doc.job_id and tenant_id = v_tenant and status = 'delivered'
      ) then
        raise exception 'this quote''s job is already delivered — its price is final';
      end if;
      -- Hole 4: type, customer and job are frozen once issued. Lines, discount,
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
      -- An edit un-signs the deal: the customer agreed the old figure, not this
      -- one. An accepted quote steps back to issued on the same number.
      status             = case when v_amend and v_doc.status = 'accepted' then 'issued' else status end,
      accepted_signature = case when v_amend then null else accepted_signature end,
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
    -- Hole 3: the owner's ceiling applies to the new figure too — no re-issue
    -- ever re-checks it. Drafts still check at issue time (the builder's
    -- save-then-ask-owner flow depends on saving first).
    perform app.assert_discount_allowed(v_id);
    -- Hole 6: a direct /edit save bypasses revise, so it audits itself.
    insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
    values (v_tenant, app.current_app_user_id(), 'quote_edited_in_place', 'document', v_id,
            jsonb_build_object('number', v_doc.number));
  end if;

  select * into v_doc from public.documents where id = v_id;
  return v_doc;
end $function$;

-- ─── prove the fences moved in ────────────────────────────────────────────
do $$
declare
  v_rev text;
  v_save text;
  v_live text;
begin
  select pg_get_functiondef('public.revise_quote(uuid)'::regprocedure) into v_rev;
  if position('quote_revised_in_place' in v_rev) = 0 then
    raise exception 'revise_quote lost its audit';
  end if;
  if position('revision_of' in v_rev) <> 0 then
    raise exception 'revise_quote still forks a revision row';
  end if;
  if position('assert_no_live_bill' in v_rev) = 0 then
    raise exception 'revise_quote lost the live-bill guard';
  end if;
  if position('accepted_signature' in v_rev) <> 0 then
    raise exception 'revise_quote still rewrites the deal on press';
  end if;

  select pg_get_functiondef('public.save_draft(jsonb,jsonb,integer)'::regprocedure) into v_save;
  if position('assert_no_live_bill' in v_save) = 0 then
    raise exception 'save_draft lost the live-bill guard';
  end if;
  if position('assert_discount_allowed' in v_save) = 0 then
    raise exception 'save_draft lost the allowance check';
  end if;
  if position('cannot change the customer on an issued quote' in v_save) = 0 then
    raise exception 'save_draft lost the identity freeze';
  end if;
  if position('quote_edited_in_place' in v_save) = 0 then
    raise exception 'save_draft lost its audit';
  end if;
  if position('a line names a car that is not this customer' in v_save) = 0 then
    raise exception 'save_draft lost the line-car check';
  end if;
  if position('app.document_cars' in v_save) = 0 then
    raise exception 'save_draft lost the header-car follow';
  end if;

  select pg_get_functiondef('app.assert_no_live_bill(uuid,uuid,text)'::regprocedure) into v_live;
  if position('credit_note' in v_live) = 0 then
    raise exception 'assert_no_live_bill lost the credited-bill retirement';
  end if;
  raise notice 'revise reopens without rewriting; save_draft edits quotes fenced on every side';
end $$;

notify pgrst, 'reload schema';
