-- ═══════════════════════════════════════════════════════════════════════════
-- Bug-hunt fixes (fiscal integrity, access control, idempotency, discounts).
-- All writes to documents/app_users go through SECURITY DEFINER RPCs (verified:
-- no direct client UPDATE in web or Android), so column-REVOKEs below only block
-- forged direct writes, never the RPCs.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Forged invoices: block direct client writes to the issuance/fiscal columns.
--    Issuance is exclusively via issue_document / credit-note / void RPCs.
-- NOTE: subtotal_excl/vat_total/total_incl are intentionally NOT revoked — they
-- are maintained by app.recompute_doc_totals (SECURITY INVOKER), and the fiscal
-- lock already blocks tampering them on an issued document.
revoke update (
  number, status, issue_date, issued_at, issued_by,
  issued_legal_name, issued_brn, issued_vat_number,
  bill_to_name, bill_to_address, bill_to_brn, bill_to_vat_number,
  vat_breakdown, amount_paid, voided_at, void_reason
) on public.documents from authenticated;

-- 2) PIN brute-force: hide the hash + lockout columns from clients. A table-level
--    SELECT grant overrides a column-level revoke, so switch to column-level grants
--    that OMIT the three secret columns. Access stays via set/clear/verify_staff_pin
--    (SECURITY DEFINER).
revoke select on public.app_users from authenticated;
grant select (id, tenant_id, auth_user_id, role, display_name, is_active, created_at, updated_at, pin_set_at, modules)
  on public.app_users to authenticated;

-- 3) Activity is owner-only: tighten audit_events read from owner/manager/accountant.
drop policy if exists audit_select on public.audit_events;
create policy audit_select on public.audit_events for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.current_user_role()) = 'owner');

-- 4) Order-level percent discount must be <= 100 (line-level already is).
alter table public.documents drop constraint if exists chk_doc_discount_pct;
alter table public.documents add constraint chk_doc_discount_pct
  check (discount_kind is distinct from 'percent' or discount_value <= 100);

-- 5) issue_document — atomic idempotency claim (advisory xact lock serializes
--    concurrent same-key calls so a double-tap can't draw two invoice numbers).
create or replace function public.issue_document(
  p_document_id uuid,
  p_stock_location_id uuid default null,
  p_idempotency_key text default null
) returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_doc    public.documents;
  v_bs     public.business_settings;
  v_cust   public.customers;
  v_number text;
  v_location uuid;
  v_lines  int;
  v_existing uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || p_idempotency_key)::bigint);
    select (result->>'document_id')::uuid into v_existing
      from public.idempotency_keys where tenant_id = v_tenant and key = p_idempotency_key;
    if v_existing is not null then
      select * into v_doc from public.documents where id = v_existing; return v_doc;
    end if;
  end if;

  select * into v_doc from public.documents
   where id = p_document_id and tenant_id = v_tenant for update;
  if not found then raise exception 'document not found'; end if;
  if v_doc.status <> 'draft' then raise exception 'document already issued (status %)', v_doc.status; end if;

  select count(*) into v_lines from public.document_lines where document_id = v_doc.id;
  if v_lines = 0 then raise exception 'cannot issue a document with no lines'; end if;
  if v_doc.doc_type = 'invoice' and v_doc.customer_id is null then
    raise exception 'an invoice requires a customer';
  end if;

  select * into v_bs from public.business_settings where id = v_tenant;
  if v_doc.customer_id is not null then
    select * into v_cust from public.customers where id = v_doc.customer_id;
  end if;

  v_number := app.next_document_number(v_tenant, v_doc.doc_type);

  update public.documents set
    number             = v_number,
    status             = 'issued',
    issue_date         = current_date,
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
      from (
        select vat_rate, sum(line_total_excl) as base, sum(line_vat) as vat
        from public.document_lines where document_id = v_doc.id group by vat_rate
      ) g
    )
  where id = v_doc.id returning * into v_doc;

  if v_doc.doc_type = 'invoice' then
    if p_stock_location_id is not null and not exists (
      select 1 from public.stock_locations where id = p_stock_location_id and tenant_id = v_tenant
    ) then raise exception 'unknown stock location'; end if;
    v_location := coalesce(
      p_stock_location_id,
      (select id from public.stock_locations where tenant_id = v_tenant and is_default limit 1)
    );
    if v_location is null and exists (
      select 1 from public.document_lines dl join public.products p on p.id = dl.product_id
      where dl.document_id = v_doc.id and p.is_stocked
    ) then raise exception 'no stock location — set a default location or pass one'; end if;
    insert into public.stock_movements
      (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, ref_line_id, created_by, note)
    select v_tenant, dl.product_id, v_location, -dl.qty, p.cost_price,
           'invoice', v_doc.id, dl.id, v_actor, 'sale on issue'
    from public.document_lines dl
    join public.products p on p.id = dl.product_id and p.tenant_id = v_tenant
    where dl.document_id = v_doc.id and p.is_stocked;
  end if;

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (tenant_id, key, rpc, result)
    values (v_tenant, p_idempotency_key, 'issue_document', jsonb_build_object('document_id', v_doc.id))
    on conflict (tenant_id, key) do nothing;
  end if;

  return v_doc;
end $$;

-- 6) record_payment — same atomic idempotency claim.
create or replace function public.record_payment(
  p_invoice_id uuid,
  p_method payment_method,
  p_amount numeric,
  p_tendered numeric default null,
  p_external_ref text default null,
  p_cash_session_id uuid default null,
  p_payment_id uuid default null,
  p_idempotency_key text default null
) returns public.payments language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_doc    public.documents;
  v_pay    public.payments;
  v_change numeric;
  v_paid   numeric;
  v_existing uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || p_idempotency_key)::bigint);
    select (result->>'payment_id')::uuid into v_existing
      from public.idempotency_keys where tenant_id = v_tenant and key = p_idempotency_key;
    if v_existing is not null then
      select * into v_pay from public.payments where id = v_existing; return v_pay;
    end if;
  end if;

  select * into v_doc from public.documents
   where id = p_invoice_id and tenant_id = v_tenant for update;
  if not found then raise exception 'invoice not found'; end if;
  if v_doc.doc_type <> 'invoice' then raise exception 'payments attach to invoices only'; end if;
  if v_doc.status not in ('issued','partly_paid') then
    raise exception 'invoice is not open for payment (status %)', v_doc.status;
  end if;
  if p_amount <= 0 then raise exception 'payment amount must be positive'; end if;
  if p_amount > (v_doc.total_incl - v_doc.amount_paid) + 0.001 then
    raise exception 'payment % exceeds outstanding balance %', p_amount, v_doc.total_incl - v_doc.amount_paid;
  end if;
  if p_cash_session_id is not null and not exists (
    select 1 from public.cash_sessions where id = p_cash_session_id and tenant_id = v_tenant and status = 'open'
  ) then raise exception 'unknown or closed cash session'; end if;

  if p_method = 'cash' then
    p_tendered := coalesce(p_tendered, p_amount);
    if p_tendered < p_amount then raise exception 'tendered is less than amount'; end if;
    v_change := p_tendered - p_amount;
  else
    if p_external_ref is null then raise exception 'a % payment requires an external reference', p_method; end if;
    p_tendered := null; v_change := null;
  end if;

  insert into public.payments
    (id, tenant_id, document_id, method, amount, tendered, change_given, external_ref, cash_session_id, received_by)
  values
    (coalesce(p_payment_id, gen_random_uuid()), v_tenant, p_invoice_id, p_method, p_amount,
     p_tendered, v_change, p_external_ref, p_cash_session_id, v_actor)
  returning * into v_pay;

  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = p_invoice_id;
  update public.documents
     set amount_paid = v_paid,
         status = (case when v_paid >= total_incl then 'paid' else 'partly_paid' end)::doc_status
   where id = p_invoice_id;

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (tenant_id, key, rpc, result)
    values (v_tenant, p_idempotency_key, 'record_payment', jsonb_build_object('payment_id', v_pay.id))
    on conflict (tenant_id, key) do nothing;
  end if;

  return v_pay;
end $$;

-- 7) reverse_payment — enrich the audit payload with document_id + method so the
--    Activity feed can link the reversal to its sale and show the method.
create or replace function public.reverse_payment(p_payment_id uuid, p_reason text default null)
returns public.payments language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_orig   public.payments;
  v_mirror public.payments;
  v_paid   numeric;
  v_doc    public.documents;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

  select * into v_orig from public.payments where id = p_payment_id and tenant_id = v_tenant for update;
  if not found then raise exception 'payment not found'; end if;
  if v_orig.amount < 0 then raise exception 'cannot reverse a reversal'; end if;
  if exists (
    select 1 from public.payments
    where reverses_payment_id = p_payment_id and tenant_id = v_tenant
  ) then
    raise exception 'payment already reversed';
  end if;

  insert into public.payments
    (tenant_id, document_id, method, amount, external_ref, reverses_payment_id, cash_session_id, received_by)
  values
    (v_tenant, v_orig.document_id, v_orig.method, -v_orig.amount,
     v_orig.external_ref, v_orig.id, v_orig.cash_session_id, v_actor)
  returning * into v_mirror;

  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = v_orig.document_id;
  select * into v_doc from public.documents where id = v_orig.document_id;
  update public.documents
     set amount_paid = v_paid,
         status = (case when v_paid >= v_doc.total_incl then 'paid'
                        when v_paid > 0 then 'partly_paid'
                        else 'issued' end)::doc_status
   where id = v_orig.document_id;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'payment_reversed', 'payment', v_orig.id,
          jsonb_build_object('reason', p_reason, 'amount', v_orig.amount,
                             'document_id', v_orig.document_id, 'method', v_orig.method));

  return v_mirror;
end $$;

-- 8) create_and_issue_credit_note — carry the invoice's order- and line-level
--    discounts forward so the CN mirrors the discounted total (was over-crediting
--    + wrong VAT), and include the credited amount in the audit payload.
create or replace function public.create_and_issue_credit_note(
  p_invoice_id uuid,
  p_stock_location_id uuid default null,
  p_restock boolean default true
) returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_inv    public.documents;
  v_bs     public.business_settings;
  v_cust   public.customers;
  v_cn     public.documents;
  v_new    uuid := gen_random_uuid();
  v_number text;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

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
    select * into v_cust from public.customers where id = v_inv.customer_id;
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
    issue_date         = current_date,
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

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'credit_note_issued', 'document', v_cn.id,
          jsonb_build_object('invoice_id', v_inv.id, 'number', v_number, 'restock', p_restock, 'amount', v_cn.total_incl));

  return v_cn;
end $$;
