-- ═══════════════════════════════════════════════════════════════════════════
-- Give a credit note the till and the trading day it belongs to.
--
-- The refund's MONEY was already handled: create_and_issue_credit_note books
-- negative payment mirrors against the open session, so the drawer count and the
-- Z-report's means-of-payment split both see the cash leave. But the credit note
-- DOCUMENT was never stamped with cash_session_id or business_day, and those are
-- the only two columns app.z_totals() scopes documents on. So the refund could
-- never appear on the sales side of a Z at all.
--
-- The result was a slip that did not foot against itself: cash down by the refund,
-- "Total incl. tax" unchanged — and disagreeing with the Sales Journal, which nets
-- credit notes correctly. An accountant reconciling the two would find it.
--
-- Body is the LIVE function verbatim (as at 2026-07-29) plus the two stamped
-- columns. 20260730000030 then teaches z_totals to net them.
-- ═══════════════════════════════════════════════════════════════════════════

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
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order)
  select v_tenant, v_new, product_id, title, description, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order
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
end $function$

