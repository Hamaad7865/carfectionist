-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration 0008 (credit notes, CN- series)
-- Void handles UNPAID issued invoices; a credit note corrects a PAID / partly-
-- paid one (money taken). Own gapless CN- series through the same numbering
-- seam. One atomic RPC: copy the invoice into a credit note and issue it,
-- optionally restocking returned goods (+qty movements). Additive only.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── CN- numbering columns ───────────────────────────────────────────────────
alter table business_settings add column if not exists credit_note_prefix         text    not null default 'CN-';
alter table business_settings add column if not exists credit_note_next_number     integer not null default 1 check (credit_note_next_number > 0);
alter table business_settings add column if not exists credit_note_number_padding  integer not null default 4;
-- Series counters move only via the RPC, never a direct client update.
revoke update (credit_note_next_number) on business_settings from authenticated;

-- ─── Extend the gapless numbering seam for credit notes ──────────────────────
create or replace function app.next_document_number(p_tenant uuid, p_doc_type doc_type)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prefix text; v_num int; v_pad int;
begin
  if p_doc_type = 'quote' then
    update public.business_settings set quote_next_number = quote_next_number + 1
     where id = p_tenant
     returning quote_prefix, quote_next_number - 1, quote_number_padding into v_prefix, v_num, v_pad;
  elsif p_doc_type = 'invoice' then
    update public.business_settings set invoice_next_number = invoice_next_number + 1
     where id = p_tenant
     returning invoice_prefix, invoice_next_number - 1, invoice_number_padding into v_prefix, v_num, v_pad;
  elsif p_doc_type = 'credit_note' then
    update public.business_settings set credit_note_next_number = credit_note_next_number + 1
     where id = p_tenant
     returning credit_note_prefix, credit_note_next_number - 1, credit_note_number_padding into v_prefix, v_num, v_pad;
  else
    raise exception 'no number series for doc_type %', p_doc_type;
  end if;
  if v_prefix is null then raise exception 'tenant % not found for numbering', p_tenant; end if;
  return v_prefix || lpad(v_num::text, v_pad, '0');
end $$;
revoke execute on function app.next_document_number(uuid, doc_type) from public;

-- ─── create_and_issue_credit_note — copy a paid invoice into an issued CN ─────
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

  -- One full-reversal credit note per invoice. The FOR UPDATE lock above
  -- serializes concurrent callers, so this check can't be raced. Runs before
  -- any number is drawn, so a rejected call consumes no CN number.
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

  -- 1) draft credit note (header copied from the invoice, linked via source)
  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, created_by)
  values
    (v_new, v_tenant, 'credit_note', 'draft', v_inv.customer_id, v_inv.vehicle_id, v_inv.job_id, v_inv.id,
     v_inv.template_id, v_inv.template_overrides, v_inv.currency, v_inv.origin, v_actor);

  -- 2) copy lines while still a draft (line-lock allows it; totals trigger fires)
  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order)
  select v_tenant, v_new, product_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order
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

  -- 4) restock returned goods: mirror the invoice's sale movements (return to
  -- the same location at the SALE-TIME cost, so COGS nets exactly), like void.
  -- ref_line_id null sidesteps the sale-dedup index.
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
          jsonb_build_object('invoice_id', v_inv.id, 'number', v_number, 'restock', p_restock));

  return v_cn;
end $$;

revoke execute on function public.create_and_issue_credit_note(uuid, uuid, boolean) from public;
grant execute on function public.create_and_issue_credit_note(uuid, uuid, boolean) to authenticated;

-- Defense in depth: at most one live credit note per invoice.
create unique index if not exists idx_credit_note_one_per_invoice
  on documents(tenant_id, source_document_id)
  where doc_type = 'credit_note' and status <> 'void';
