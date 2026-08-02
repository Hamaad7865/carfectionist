-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a replay answers from the ledger, before any guard speaks.
--
-- 20260730000050 moved app.assert_day_open BELOW issue_document's
-- idempotency-key replay branch, so that a delayed retry of an ALREADY-issued
-- sale hands back the cached invoice instead of a lecture about the till.
-- 20260730000060 (the shop-floor stock fix, the very next migration) rebuilt
-- the function from 20260715000010's text — which predates that fix — and
-- silently put the guard back in front. Verified still wrong in production
-- today: pg_get_functiondef shows assert_day_open ahead of the replay lookup.
--
-- Why it matters more now than it did then. Offline sales queue on the tablet
-- and replay when the network returns. By then the till that rang them may
-- have gone stale or the day may have closed — the exact conditions
-- assert_day_open refuses on. Guarding first means a sale that HAS an invoice
-- gets told the day is closed; the client reads that as a definitive refusal
-- (SaleRepository.DETERMINISTIC_ISSUE_REJECTIONS) and lets the cashier ring it
-- again. A replay must be able to answer from the ledger it already wrote.
--
-- Written as one literal CREATE OR REPLACE — the whole live body, guard moved,
-- nothing else touched — rather than a text splice, so what is installed is
-- exactly what is read here. The ordering carries a warning in the body itself,
-- which travels with pg_get_functiondef: the last revert came from copying an
-- older migration's text, so the warning has to live where a copier will see it.
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

  -- ORDER IS LOAD-BEARING: the replay branch below runs BEFORE
  -- app.assert_day_open. A retry of an already-issued sale must return its
  -- invoice even if the till has since gone stale or the day has closed —
  -- nothing new is written, so there is nothing for the guard to protect, and
  -- a refusal there tells the client to re-ring a sale that already exists.
  -- Do not "restore" the guard to the top. See 20260802000010.
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

  -- A closed day takes no more money — and ringing a NEW ticket is taking money.
  perform app.assert_day_open(v_tenant, p_session_id);

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
end $function$;

-- ── prove it, against what is actually installed ────────────────────────────
-- The last revert passed review because nobody re-read the live function. This
-- fails the migration rather than let the wrong order reach production again.
do $$
declare
  v_def text;
  v_guard int;
  v_replay int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'issue_document';
  if v_def is null then raise exception 'public.issue_document not found'; end if;

  -- the CALL, not the warning comment that names the same function above it
  v_guard  := position('perform app.assert_day_open' in v_def);
  v_replay := position('from public.idempotency_keys' in v_def);
  if v_guard = 0 then raise exception 'issue_document lost its assert_day_open call'; end if;
  if v_replay = 0 then raise exception 'issue_document lost its idempotency replay branch'; end if;
  if v_guard < v_replay then
    raise exception 'issue_document still guards before it replays (guard @ %, replay @ %)', v_guard, v_replay;
  end if;
  raise notice 'issue_document replays before it guards (replay @ %, guard @ %)', v_replay, v_guard;
end $$;
