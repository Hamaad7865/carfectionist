-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration 0006 (duplicate_document)
-- Copy any quote or invoice into a NEW draft of the same type (source_document_id
-- links them). The original is untouched — an issued/paid invoice stays locked;
-- the copy is a fresh draft that takes its own number when issued. Credit notes
-- are not duplicable.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.duplicate_document(p_id uuid)
returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
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
     template_id, template_overrides, currency, origin, created_by)
  values
    (v_new, v_tenant, v_src.doc_type, 'draft', v_src.customer_id, v_src.vehicle_id, v_src.job_id, v_src.id,
     v_src.template_id, v_src.template_overrides, v_src.currency, v_src.origin, app.current_app_user_id())
  returning * into v_dup;

  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order)
  select v_tenant, v_new, product_id, title, description, qty, unit_price, discount_pct, vat_rate, sort_order
  from public.document_lines where document_id = v_src.id;

  select * into v_dup from public.documents where id = v_new;  -- totals via trigger
  return v_dup;
end $$;

revoke execute on function public.duplicate_document(uuid) from public;
grant execute on function public.duplicate_document(uuid) to authenticated;
