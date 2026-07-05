-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration 0005 (revise_quote)
-- Quotes aren't fiscal documents, so a revision is a NEW draft quote copied
-- from an issued one (source_document_id links them). The original is left
-- untouched as a record; the revision gets its own number when re-issued.
-- Invoices are deliberately NOT revisable (fiscal lock → void / credit note).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.revise_quote(p_quote_id uuid)
returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
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

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, created_by)
  values
    (v_new, v_tenant, 'quote', 'draft', v_q.customer_id, v_q.vehicle_id, v_q.job_id, v_q.id,
     v_q.template_id, v_q.template_overrides, v_q.currency, v_q.origin, app.current_app_user_id())
  returning * into v_rev;

  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order)
  select v_tenant, v_new, product_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order
  from public.document_lines where document_id = v_q.id;

  select * into v_rev from public.documents where id = v_new;  -- totals via trigger
  return v_rev;
end $$;

revoke execute on function public.revise_quote(uuid) from public;
grant execute on function public.revise_quote(uuid) to authenticated;
