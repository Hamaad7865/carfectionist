-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a refund is money, so it lives in the ledger
--
-- Two confirmed audit gaps, one coherent rule:
--
-- 1) A credit note against a PAID invoice refunds real money, but the RPC wrote
--    only the fiscal document — no payment row, no till movement. The drawer
--    count, the Z-report and the statement each told a different story about
--    the same rupees. Now the refund is booked: each standing payment on the
--    source invoice gets a NEGATIVE mirror attached to the credit note,
--    reversing it (reverses_payment_id) and booked to the till it comes out of
--    — so the drawer's expected cash drops (close_cash_session sums cash by
--    booked_session_id), the Z's means-of-payment nets down, and PAID TODAY
--    shows the walk-back. Cash needs an open till to come out of, same rule as
--    reverse_payment. The invoice itself stays PAID — the credit note is its
--    fiscal reversal; nothing may quietly reopen it.
--
-- 2) reverse_payment and the credit note didn't know about each other: a fully
--    credited invoice could be flipped back to 'issued' by reversing its
--    payment, re-appearing in TO COLLECT after the customer was refunded —
--    collectable twice. The mirrors close this for new credit notes (the
--    original payments now read "already reversed"), and an explicit guard
--    closes it for credit notes issued before this migration.
--
-- The old 3-arg signature is dropped: PostgREST cannot disambiguate a 3-arg
-- call between the old function and the new one's defaults.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.create_and_issue_credit_note(uuid, uuid, boolean);

create or replace function public.create_and_issue_credit_note(
  p_invoice_id uuid,
  p_stock_location_id uuid default null::uuid,
  p_restock boolean default true,
  -- The till the refund is paid out of / booked to. Null = fall back per payment
  -- to the open till of the device that took the original money (same rule as
  -- reverse_payment), so old app versions keep working.
  p_session_id uuid default null::uuid
) returns documents language plpgsql security definer set search_path = public, pg_temp as $function$
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

grant execute on function public.create_and_issue_credit_note(uuid, uuid, boolean, uuid) to authenticated;

-- reverse_payment: the two guards now know about each other. Byte-identical to
-- 20260716000030 except the credit-note check (covers credit notes issued BEFORE
-- the mirrors existed — new ones already read "payment already reversed").
create or replace function public.reverse_payment(p_payment_id uuid, p_reason text default null::text, p_session_id uuid default null::uuid)
returns payments language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_orig   public.payments;
  v_mirror public.payments;
  v_booked uuid;
  v_paid   numeric;
  v_doc    public.documents;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'a reason is required to reverse a payment';
  end if;

  select * into v_orig from public.payments where id = p_payment_id and tenant_id = v_tenant for update;
  if not found then raise exception 'payment not found'; end if;
  if v_orig.amount < 0 then raise exception 'cannot reverse a reversal'; end if;
  if exists (
    select 1 from public.payments where reverses_payment_id = p_payment_id and tenant_id = v_tenant
  ) then
    raise exception 'payment already reversed';
  end if;
  -- A credit-noted invoice's money was already walked back by the refund — flipping
  -- the invoice open again here would make it collectable a second time.
  if exists (
    select 1 from public.documents cn
     where cn.tenant_id = v_tenant and cn.doc_type = 'credit_note'
       and cn.source_document_id = v_orig.document_id and cn.status <> 'void'
  ) then
    raise exception 'this invoice has a credit note — the refund already reversed its money';
  end if;

  -- Where does the refund come OUT of? The till it is being done on. Falling back to
  -- the open till of the device that took the money keeps a tablet refund on that
  -- tablet's drawer without the caller having to say so.
  v_booked := p_session_id;
  if v_booked is null and v_orig.cash_session_id is not null then
    select s2.id into v_booked
      from public.cash_sessions s1
      join public.cash_sessions s2
        on s2.device_id = s1.device_id and s2.tenant_id = s1.tenant_id and s2.status = 'open'
     where s1.id = v_orig.cash_session_id;
  end if;
  if v_booked is not null and not exists (
    select 1 from public.cash_sessions where id = v_booked and tenant_id = v_tenant and status = 'open'
  ) then raise exception 'unknown or closed cash session'; end if;

  -- Cash leaves a physical drawer. Without an open till there is nowhere to take it
  -- from, and the old code silently took it out of a CLOSED one.
  if v_orig.method = 'cash' and v_booked is null then
    raise exception 'a cash refund needs an open till — open the till first';
  end if;

  insert into public.payments
    (tenant_id, document_id, method, amount, external_ref, reverses_payment_id,
     cash_session_id, booked_session_id, received_by)
  values
    (v_tenant, v_orig.document_id, v_orig.method, -v_orig.amount,
     v_orig.external_ref, v_orig.id,
     v_orig.cash_session_id,  -- traceability: which till took the original money
     v_booked,                -- the drawer this refund actually comes out of
     v_actor)
  returning * into v_mirror;

  -- Lock the document BEFORE summing so a concurrent record_payment/reverse_payment on
  -- the same invoice cannot lose an update to amount_paid/status (audit finding #1).
  select * into v_doc from public.documents where id = v_orig.document_id for update;
  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = v_orig.document_id;
  update public.documents
     set amount_paid = v_paid,
         status = (case when v_paid >= v_doc.total_incl then 'paid'
                        when v_paid > 0 then 'partly_paid'
                        else 'issued' end)::doc_status
   where id = v_orig.document_id;

  -- Money walked back: a job auto-delivered by THIS payment must not stay
  -- "delivered" against a bill no longer settled. The discriminator is the
  -- transaction timestamp — record_payment stamps delivered_at and the payment's
  -- received_at from the same now(), so equality means this payment caused the
  -- delivery. A car that left on account or was collected after prepaying keeps
  -- its delivery: that handover happened at the kerb, not in this ledger.
  -- (Restores the walk-back lost when this function was rewritten; the RPC is
  -- already owner/manager-only, which jobs_guard requires for un-delivering.)
  if v_doc.job_id is not null and v_paid < v_doc.total_incl then
    update public.jobs
       set status = 'ready', delivered_at = null
     where id = v_doc.job_id and tenant_id = v_tenant and status = 'delivered'
       and delivered_at = v_orig.received_at;
    if found then
      insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
      values (v_tenant, v_actor, 'job_delivery_reversed', 'job', v_doc.job_id,
              jsonb_build_object('reason', trim(p_reason), 'invoice', v_doc.number));
    end if;
  end if;

  -- NOTE: the old version updated the ORIGINAL session's expected_cash and variance
  -- here. That is what rewrote a closed, counted, signed-off drawer. It is gone: the
  -- refund shows up in the drawer it came out of, through booked_session_id, when
  -- that till is closed.

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'payment_reversed', 'payment', v_orig.id,
          jsonb_build_object('amount', v_orig.amount, 'method', v_orig.method,
                             'reason', trim(p_reason),
                             'booked_session', v_booked, 'original_session', v_orig.cash_session_id));

  return v_mirror;
end $function$;
