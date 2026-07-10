-- ═══════════════════════════════════════════════════════════════════════════
-- convert_quote_to_invoice: a double-tap (or a client retry after an ambiguous
-- response) produced TWO draft invoices from one quote — each separately
-- issuable and payable, i.e. a double-billing risk. Its sibling
-- convert_quote_to_job already guards this with a FOR UPDATE lock + idempotent
-- return; this brings the invoice path to parity.
--
--  · A partial unique index makes "at most one live invoice per source quote" a
--    hard rule (nulls unconstrained, so standalone/job invoices are unaffected;
--    a voided invoice frees the slot for a re-conversion).
--  · The function now locks the quote FOR UPDATE (so a concurrent second caller
--    serialises) and returns the existing invoice if one is already there.
-- Additive; SECURITY DEFINER preserved.
-- ═══════════════════════════════════════════════════════════════════════════

create unique index if not exists idx_invoice_one_per_quote
  on public.documents (source_document_id)
  where doc_type = 'invoice' and source_document_id is not null and status <> 'void';

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

  -- Lock the quote so a double-tap serialises: the second caller blocks here,
  -- then falls into the idempotent return below.
  select * into v_q from public.documents where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;

  -- Idempotent: this quote already has a live invoice — hand back the same one.
  select * into v_inv from public.documents
   where source_document_id = v_q.id and doc_type = 'invoice' and tenant_id = v_tenant and status <> 'void'
   limit 1;
  if found then return v_inv; end if;

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, discount_kind, discount_value, created_by)
  values
    (v_new, v_tenant, 'invoice', 'draft', v_q.customer_id, v_q.vehicle_id, v_q.job_id, v_q.id,
     v_q.template_id, v_q.template_overrides, v_q.currency, v_q.origin, v_q.discount_kind, v_q.discount_value, app.current_app_user_id())
  returning * into v_inv;

  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order)
  select v_tenant, v_new, product_id, title, description, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order
  from public.document_lines where document_id = v_q.id;

  update public.documents set status = 'accepted' where id = v_q.id and status = 'issued';
  select * into v_inv from public.documents where id = v_new;
  return v_inv;
end $$;
