-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a copied line keeps its description
--
-- 20260804000020 gave document_lines description_richtext and unit_label, and
-- taught save_draft to write them. It did not teach the four functions that copy
-- lines from one document to another, and every one of them names its columns
-- explicitly — so the bullets survived being typed and then vanished the moment
-- the quote became anything else:
--
--   convert_quote_to_invoice     a quote billed loses what it was selling
--   revise_quote                 revising a quote empties the new revision
--   duplicate_document           a duplicate comes back blank
--   create_and_issue_credit_note a credit note stops saying what it reverses
--
-- Each body below is the LIVE definition read straight out of the database with
-- pg_get_functiondef, with description_richtext and unit_label added to the
-- document_lines copy and nothing else touched. Read from the database rather
-- than from the newest migration file on purpose: four of these have been
-- redefined several times across a dozen migrations, and picking the wrong file
-- would silently revert a guard nobody would notice was gone.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── convert_quote_to_invoice ────────────────────────────────────────────
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
end $function$;

-- ── revise_quote ────────────────────────────────────────────────────────
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
end $function$;

-- ── duplicate_document ──────────────────────────────────────────────────
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
end $function$;

-- ── create_and_issue_credit_note ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_and_issue_credit_note(p_invoice_id uuid, p_stock_location_id uuid DEFAULT NULL::uuid, p_restock boolean DEFAULT true, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_inv    public.documents;
  v_bs     public.business_settings;
  v_cust   public.customers;
  v_cn     public.documents;
  v_new    uuid := gen_random_uuid();
  v_number text;
  v_pay    public.payments;
  v_booked uuid;
  v_refund numeric := 0;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

  if p_session_id is not null and not exists (
    select 1 from public.cash_sessions where id = p_session_id and tenant_id = v_tenant and status = 'open'
  ) then raise exception 'unknown or closed cash session'; end if;
  perform app.assert_till_day_current(p_session_id);

  select * into v_inv from public.documents where id = p_invoice_id and tenant_id = v_tenant for update;
  if not found then raise exception 'invoice not found'; end if;
  if v_inv.doc_type <> 'invoice' then raise exception 'credit notes are raised against invoices'; end if;
  if v_inv.status not in ('issued','partly_paid','paid') then raise exception 'only an issued invoice can be credited'; end if;

  if exists (
    select 1 from public.documents
     where tenant_id = v_tenant and doc_type = 'credit_note'
       and source_document_id = v_inv.id and status <> 'void'
  ) then raise exception 'this invoice already has a credit note'; end if;

  if p_stock_location_id is not null and not exists (
    select 1 from public.stock_locations where id = p_stock_location_id and tenant_id = v_tenant
  ) then raise exception 'unknown stock location'; end if;

  select * into v_bs from public.business_settings where id = v_tenant;
  if v_inv.customer_id is not null then
    -- Tenant-checked (same reasoning as issue_document).
    select * into v_cust from public.customers where id = v_inv.customer_id and tenant_id = v_tenant;
    if not found then raise exception 'customer does not belong to this tenant'; end if;
  end if;

  -- 1) draft credit note (header copied from the invoice, incl. its order discount)
  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, created_by, discount_kind, discount_value)
  values
    (v_new, v_tenant, 'credit_note', 'draft', v_inv.customer_id, v_inv.vehicle_id, v_inv.job_id, v_inv.id,
     v_inv.template_id, v_inv.template_overrides, v_inv.currency, v_inv.origin, v_actor,
     v_inv.discount_kind, v_inv.discount_value);

  -- 2) copy lines incl. their line-level discount (kind + pct + amount)
  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order)
  select v_tenant, v_new, product_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order
  from public.document_lines where document_id = v_inv.id;

  -- 3) assign the CN number + fiscal snapshot (draft->issued; fiscal lock not yet active)
  v_number := app.next_document_number(v_tenant, 'credit_note');
  update public.documents set
    number             = v_number,
    status             = 'issued',
    issue_date         = ((now() at time zone 'utc') + interval '4 hours')::date,
    issued_at          = now(),
    issued_legal_name  = v_bs.legal_name,
    issued_brn         = v_bs.brn,
    issued_vat_number  = v_bs.vat_number,
    bill_to_name       = v_cust.name,
    bill_to_address    = v_cust.address,
    bill_to_brn        = v_cust.brn,
    bill_to_vat_number = v_cust.vat_number,
    -- Which till rang the refund and which trading day it belongs to. The Z-report
    -- scopes on exactly these two columns, and a credit note was never given either,
    -- so the money left the drawer (the negative payment mirrors below are booked to
    -- the session) while the sales side of the same slip never knew the refund existed.
    -- Same rule invoices follow: a refund taken after local midnight on a till opened
    -- before it belongs to that till's trading day, not to the new calendar date.
    cash_session_id    = p_session_id,
    business_day       = coalesce(
                           (select td.business_date
                              from public.cash_sessions cs
                              join public.trading_days td on td.id = cs.trading_day_id
                             where cs.id = p_session_id),
                           app.mu_today()),
    vat_breakdown      = (
      select jsonb_agg(jsonb_build_object('rate', g.vat_rate, 'base', g.base, 'vat', g.vat) order by g.vat_rate)
      from (select vat_rate, sum(line_total_excl) as base, sum(line_vat) as vat
            from public.document_lines where document_id = v_new group by vat_rate) g
    )
  where id = v_new returning * into v_cn;

  if p_restock then
    insert into public.stock_movements
      (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, ref_line_id, created_by, note)
    select v_tenant, m.product_id, coalesce(p_stock_location_id, m.location_id), -m.qty, m.unit_cost,
           'credit_note', v_cn.id, null, v_actor, 'credit note restock'
    from public.stock_movements m
    where m.tenant_id = v_tenant and m.ref_type = 'invoice' and m.ref_id = v_inv.id and m.ref_line_id is not null;
  end if;

  -- 4) THE REFUND, BOOKED. Every standing payment on the invoice is mirrored
  -- negative onto the credit note and marked as its reversal — the drawer, the
  -- Z and PAID TODAY all see the money leave. The invoice's own amount_paid is
  -- deliberately untouched: it stays PAID, the credit note is the reversal.
  for v_pay in
    select * from public.payments p
     where p.tenant_id = v_tenant and p.document_id = v_inv.id
       and p.amount > 0 and p.reverses_payment_id is null
       and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
  loop
    v_booked := p_session_id;
    if v_booked is null and v_pay.cash_session_id is not null then
      select s2.id into v_booked
        from public.cash_sessions s1
        join public.cash_sessions s2
          on s2.device_id = s1.device_id and s2.tenant_id = s1.tenant_id and s2.status = 'open'
       where s1.id = v_pay.cash_session_id;
    end if;
    -- Cash leaves a physical drawer; without an open till there is nowhere to take it from.
    if v_pay.method = 'cash' and v_booked is null then
      raise exception 'a cash refund needs an open till — open the till first';
    end if;
    insert into public.payments
      (tenant_id, document_id, method, amount, external_ref, reverses_payment_id,
       cash_session_id, booked_session_id, received_by)
    values
      (v_tenant, v_cn.id, v_pay.method, -v_pay.amount,
       v_pay.external_ref, v_pay.id,
       v_pay.cash_session_id,  -- traceability: which till took the original money
       v_booked,               -- the drawer this refund actually comes out of
       v_actor);
    v_refund := v_refund + v_pay.amount;
  end loop;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'credit_note_issued', 'document', v_cn.id,
          jsonb_build_object('invoice_id', v_inv.id, 'number', v_number, 'restock', p_restock,
                             'amount', v_cn.total_incl, 'refunded', v_refund));

  return v_cn;
end $function$;

