-- ═══════════════════════════════════════════════════════════════════════════
-- A sale comes off the SHOP FLOOR, never the bulk store.
--
-- issue_document, when the caller named no location, fell back to the DEFAULT
-- location — which is the bulk store (the Warehouse), where received stock lands.
-- Only the counter sale passed a location explicitly (the sales floor), so:
--   • counter sales      → Shop        ✓
--   • quote → invoice    → Warehouse   ✗   (billed with no location)
--   • job  → invoice     → Warehouse   ✗
--   • accept-without-job → Warehouse   ✗
-- That is the "WIPER … Sale … Warehouse -1" the owner saw, and the same thing on
-- an intake billed for Yan Toinette: the wipers were rung on a quote/job invoice,
-- which named no location, so the deduction hit the Warehouse the till is supposed
-- never to touch.
--
-- The fix is here rather than in the four client call sites, because "make every
-- caller pass the shop location" is exactly the fragile arrangement that let this
-- through — one missed call and the stock walks off the wrong shelf again. A sale
-- has one correct answer for where the goods leave from, so the shared RPC owns it.
--
-- The fallback now mirrors the clients' own sales-floor resolver
-- (apps/web/src/lib/supabase/locations.ts pickSalesFloor, PosApi.fetchShopLocationId):
-- is_sales_floor first because it is the only answer that is a FACT about the
-- business, then the literal name 'Shop', then any non-default location, and only
-- as a true last resort — a single-location shop, where the one location is both
-- store and floor — the default itself. Received stock and transfers are untouched:
-- they still land in / move to the location they name.
--
-- Body is the live issue_document (20260715000010_audit_fixes) verbatim, with only
-- the location fallback changed and its now-misleading error message reworded.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.issue_document(p_document_id uuid, p_stock_location_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- A closed day takes no more money — and ringing a new ticket is taking money.
  perform app.assert_day_open(v_tenant, p_session_id);

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || p_idempotency_key)::bigint);
    select (result->>'document_id')::uuid into v_existing
      from public.idempotency_keys where tenant_id = v_tenant and key = p_idempotency_key;
    if v_existing is not null then
      select * into v_doc from public.documents where id = v_existing;
      -- The key must belong to THIS document: a guessable key (quote-accept:<id>)
      -- must not hand back some other document issued under it earlier.
      if v_doc.id is distinct from p_document_id then
        raise exception 'idempotency key was already used for a different document';
      end if;
      return v_doc;
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

  if p_session_id is not null and not exists (
    select 1 from public.cash_sessions
     where id = p_session_id and tenant_id = v_tenant and status = 'open'
  ) then raise exception 'unknown or closed cash session'; end if;

  select * into v_bs from public.business_settings where id = v_tenant;
  if v_doc.customer_id is not null then
    -- Tenant-checked: SECURITY DEFINER bypasses RLS, and customer_id arrives on
    -- a client-writable draft — without this a foreign customer's identity
    -- could be stamped onto our fiscal snapshot.
    select * into v_cust from public.customers where id = v_doc.customer_id and tenant_id = v_tenant;
    if not found then raise exception 'customer does not belong to this tenant'; end if;
  end if;

  v_number := app.next_document_number(v_tenant, v_doc.doc_type);

  update public.documents set
    number             = v_number,
    status             = 'issued',
    issue_date         = ((now() at time zone 'utc') + interval '4 hours')::date, -- the MAURITIUS calendar day (current_date is the DB's UTC day: evening issues misfiled a day early)
    issued_at          = now(),
    issued_legal_name  = v_bs.legal_name,
    issued_brn         = v_bs.brn,
    issued_vat_number  = v_bs.vat_number,
    bill_to_name       = v_cust.name,
    bill_to_address    = v_cust.address,
    bill_to_brn        = v_cust.brn,
    bill_to_vat_number = v_cust.vat_number,
    -- Which service rang it, and which trading day it belongs to. Both are what the Z
    -- report scopes on; without them a sale is invisible to the cash-up.
    cash_session_id    = coalesce(p_session_id, v_doc.cash_session_id),
    business_day       = coalesce(
                           v_doc.business_day,
                           -- A sale rung after local midnight on a till opened before it
                           -- belongs to that till's trading day, not today (audit #2).
                           (select td.business_date
                              from public.cash_sessions cs
                              join public.trading_days td on td.id = cs.trading_day_id
                             where cs.id = coalesce(p_session_id, v_doc.cash_session_id)),
                           app.mu_today()),
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
    -- The goods leave the SHOP FLOOR unless the caller names somewhere else. This is
    -- the clients' pickSalesFloor / fetchShopLocationId precedence, so a counter sale
    -- (which passes the floor) and a quote/job invoice (which passes nothing) now come
    -- off the SAME shelf. is_default is the last resort only — a one-location shop.
    v_location := coalesce(
      p_stock_location_id,
      (select id from public.stock_locations
        where tenant_id = v_tenant and is_sales_floor order by name limit 1),
      (select id from public.stock_locations
        where tenant_id = v_tenant and name = 'Shop' order by name limit 1),
      (select id from public.stock_locations
        where tenant_id = v_tenant and not is_default order by name limit 1),
      (select id from public.stock_locations
        where tenant_id = v_tenant and is_default limit 1)
    );
    if v_location is null and exists (
      select 1 from public.document_lines dl join public.products p on p.id = dl.product_id
      where dl.document_id = v_doc.id and p.is_stocked
    ) then raise exception 'no stock location — set a sales-floor (or default) location, or pass one'; end if;
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
end $function$
;
