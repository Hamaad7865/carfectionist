-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — migration 0003 (money-path RPCs)
-- The gapless numbering seam + issue/payment/draft/convert/void, all
-- SECURITY DEFINER, tenant-resolved internally. Deferred from 0001 so they are
-- built and tested against real seeded data (Phase 1).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Gapless numbering (atomic; rolls back with the issue txn) ───────────────
create or replace function app.next_document_number(p_tenant uuid, p_doc_type doc_type)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prefix text; v_num int; v_pad int;
begin
  if p_doc_type = 'quote' then
    update public.business_settings
       set quote_next_number = quote_next_number + 1
     where id = p_tenant
     returning quote_prefix, quote_next_number - 1, quote_number_padding
       into v_prefix, v_num, v_pad;
  elsif p_doc_type = 'invoice' then
    update public.business_settings
       set invoice_next_number = invoice_next_number + 1
     where id = p_tenant
     returning invoice_prefix, invoice_next_number - 1, invoice_number_padding
       into v_prefix, v_num, v_pad;
  else
    raise exception 'no number series for doc_type %', p_doc_type;
  end if;
  if v_prefix is null then
    raise exception 'tenant % not found for numbering', p_tenant;
  end if;
  return v_prefix || lpad(v_num::text, v_pad, '0');
end $$;
revoke execute on function app.next_document_number(uuid, doc_type) from public;

-- ─── save_draft — builder autosave (upsert doc + replace lines) ──────────────
create or replace function public.save_draft(p_doc jsonb, p_lines jsonb, p_expected_rev int default null)
returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_id uuid;
  v_doc public.documents;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  v_id := coalesce(nullif(p_doc->>'id','')::uuid, gen_random_uuid());
  select * into v_doc from public.documents where id = v_id and tenant_id = v_tenant for update;

  if found then
    if v_doc.status <> 'draft' then raise exception 'cannot edit an issued document'; end if;
    if p_expected_rev is not null and v_doc.revision <> p_expected_rev then
      raise exception 'document was modified elsewhere (rev % expected %)', v_doc.revision, p_expected_rev;
    end if;
    update public.documents set
      doc_type           = coalesce(nullif(p_doc->>'doc_type','')::doc_type, doc_type),
      customer_id        = nullif(p_doc->>'customer_id','')::uuid,
      vehicle_id         = nullif(p_doc->>'vehicle_id','')::uuid,
      template_id        = nullif(p_doc->>'template_id','')::uuid,
      template_overrides = coalesce(p_doc->'template_overrides', template_overrides),
      valid_until        = nullif(p_doc->>'valid_until','')::date,
      due_date           = nullif(p_doc->>'due_date','')::date,
      origin             = coalesce(nullif(p_doc->>'origin',''), origin),
      revision           = revision + 1
    where id = v_id returning * into v_doc;
  else
    insert into public.documents
      (id, tenant_id, doc_type, status, customer_id, vehicle_id, template_id,
       template_overrides, valid_until, due_date, origin, created_by)
    values
      (v_id, v_tenant, coalesce(nullif(p_doc->>'doc_type','')::doc_type, 'quote'), 'draft',
       nullif(p_doc->>'customer_id','')::uuid, nullif(p_doc->>'vehicle_id','')::uuid,
       nullif(p_doc->>'template_id','')::uuid, coalesce(p_doc->'template_overrides', '{}'::jsonb),
       nullif(p_doc->>'valid_until','')::date, nullif(p_doc->>'due_date','')::date,
       coalesce(nullif(p_doc->>'origin',''), 'standalone'), app.current_app_user_id())
    returning * into v_doc;
  end if;

  delete from public.document_lines where document_id = v_id;
  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order)
  select
    v_tenant, v_id,
    nullif(l->>'product_id','')::uuid,
    coalesce(l->>'title',''),
    nullif(l->>'description',''),
    coalesce((l->>'qty')::numeric, 1),
    coalesce((l->>'unit_price')::numeric, 0),
    coalesce((l->>'discount_pct')::numeric, 0),
    coalesce((l->>'vat_rate')::numeric, 15),
    coalesce((l->>'sort_order')::int, (ord - 1)::int)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(l, ord);

  select * into v_doc from public.documents where id = v_id;  -- totals set by trigger
  return v_doc;
end $$;

-- ─── issue_document — gapless number + fiscal snapshot + sale movements ───────
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

  -- Event-sourced stock: invoices fire sale movements for stocked catalogue lines.
  if v_doc.doc_type = 'invoice' then
    -- FK checks bypass RLS inside a definer fn: validate the client-supplied location.
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

-- ─── record_payment — child of invoice; recomputes status ────────────────────
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
  -- FK checks bypass RLS inside a definer fn: the cash session must be ours and open.
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

-- ─── reverse_payment — the only correction path (negative mirror + audit) ─────
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

  -- Lock the original so two concurrent reversals serialize (the second then
  -- sees the first's mirror below and is rejected — no double-refund).
  select * into v_orig from public.payments where id = p_payment_id and tenant_id = v_tenant for update;
  if not found then raise exception 'payment not found'; end if;
  if v_orig.amount < 0 then raise exception 'cannot reverse a reversal'; end if;
  -- Idempotency / double-click guard: never reverse the same payment twice.
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
          jsonb_build_object('reason', p_reason, 'amount', v_orig.amount));

  return v_mirror;
end $$;

-- ─── convert_quote_to_invoice — copy into a new draft invoice ─────────────────
create or replace function public.convert_quote_to_invoice(p_quote_id uuid)
returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_q   public.documents;
  v_inv public.documents;
  v_new uuid := gen_random_uuid();
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents where id = p_quote_id and tenant_id = v_tenant;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, created_by)
  values
    (v_new, v_tenant, 'invoice', 'draft', v_q.customer_id, v_q.vehicle_id, v_q.job_id, v_q.id,
     v_q.template_id, v_q.template_overrides, v_q.currency, v_q.origin, app.current_app_user_id())
  returning * into v_inv;

  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order)
  select v_tenant, v_new, product_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order
  from public.document_lines where document_id = v_q.id;

  update public.documents set status = 'accepted' where id = v_q.id and status = 'issued';

  select * into v_inv from public.documents where id = v_new;  -- totals via trigger
  return v_inv;
end $$;

-- ─── void_document — void an unpaid issued invoice (reversal movements) ───────
create or replace function public.void_document(p_id uuid, p_reason text)
returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_doc    public.documents;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

  select * into v_doc from public.documents where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'document not found'; end if;
  if v_doc.doc_type <> 'invoice' then raise exception 'only invoices are voided (credit notes reverse paid invoices)'; end if;
  if v_doc.status = 'void' then return v_doc; end if;
  if v_doc.status = 'draft' then raise exception 'delete drafts instead of voiding'; end if;
  if v_doc.amount_paid <> 0 then raise exception 'cannot void a paid invoice; issue a credit note'; end if;

  -- reversal stock movements (ref_line_id null to sidestep the sale dedup index)
  insert into public.stock_movements
    (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, ref_line_id, created_by, note)
  select tenant_id, product_id, location_id, -qty, unit_cost, 'invoice', ref_id, null, v_actor, 'void reversal'
  from public.stock_movements
  where tenant_id = v_tenant and ref_type = 'invoice' and ref_id = p_id and ref_line_id is not null;

  update public.documents
     set status = 'void', voided_at = now(), void_reason = p_reason
   where id = p_id returning * into v_doc;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'document_voided', 'document', p_id, jsonb_build_object('reason', p_reason));

  return v_doc;
end $$;

-- ─── Grants: client-callable RPCs to authenticated only ──────────────────────
revoke execute on function public.save_draft(jsonb, jsonb, int) from public;
revoke execute on function public.issue_document(uuid, uuid, text) from public;
revoke execute on function public.record_payment(uuid, payment_method, numeric, numeric, text, uuid, uuid, text) from public;
revoke execute on function public.reverse_payment(uuid, text) from public;
revoke execute on function public.convert_quote_to_invoice(uuid) from public;
revoke execute on function public.void_document(uuid, text) from public;

grant execute on function public.save_draft(jsonb, jsonb, int) to authenticated;
grant execute on function public.issue_document(uuid, uuid, text) to authenticated;
grant execute on function public.record_payment(uuid, payment_method, numeric, numeric, text, uuid, uuid, text) to authenticated;
grant execute on function public.reverse_payment(uuid, text) to authenticated;
grant execute on function public.convert_quote_to_invoice(uuid) to authenticated;
grant execute on function public.void_document(uuid, text) to authenticated;
