-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — fixes from the adversarial production bug audit
--
-- Five backend defects, each confirmed against the live schema before writing:
--   #1  reverse_payment did not lock the document before recomputing amount_paid,
--       so a concurrent payment/reversal on one invoice was a lost update.
--   #2  a sale rung after local midnight on a still-open till was dropped from the
--       DAY Z-report's sales/VAT/tickets while its cash was still counted — the slip
--       no longer balanced. Anchor the doc's business day to its session's trading day.
--   #3  'authenticated' retained column-level UPDATE on documents.total_incl /
--       subtotal_excl / vat_total (the residue the earlier lock migration missed),
--       so any staff could rewrite a draft invoice's money and freeze it on issue.
--   #9  open_cash_session raced two tills to the same service number.
--   #10 an ad-hoc line accepted a negative unit price → a negative-total invoice.
--
-- The three function bodies below are the LIVE definitions, reproduced verbatim by
-- pg_get_functiondef with exactly one surgical change each (generated, not hand-typed).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── #3: revoke the residual money-column write grant ─────────────────────────
revoke update (subtotal_excl, vat_total, total_incl) on public.documents from authenticated;
-- Belt-and-suspenders: the sole legitimate writer runs as owner regardless of caller.
alter function app.recompute_doc_totals(uuid) security definer set search_path = public, pg_temp;

-- ── #10: no line may carry a negative unit price, on any path ─────────────────
alter table public.document_lines drop constraint if exists document_lines_unit_price_nonneg;
alter table public.document_lines add constraint document_lines_unit_price_nonneg check (unit_price >= 0);

-- ── #9 backstop: one service number per (tenant, trading day) ─────────────────
create unique index if not exists cash_sessions_day_service_uq on public.cash_sessions (tenant_id, trading_day_id, service_no);


-- ── #1 ──
CREATE OR REPLACE FUNCTION public.reverse_payment(p_payment_id uuid, p_reason text DEFAULT NULL::text, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$

;

-- ── #2 ──
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
end $function$

;

-- ── #9 ──
CREATE OR REPLACE FUNCTION public.open_cash_session(p_device_id text, p_opening_float numeric)
 RETURNS cash_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_day    public.trading_days;
  v_dev    text := coalesce(nullif(p_device_id, ''), 'back-office');
  v_no     int;
  v_sess   public.cash_sessions;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');
  if p_opening_float is null or p_opening_float < 0 then
    raise exception 'count the opening float before opening the till';
  end if;

  -- Opens today's day if the shop has not opened yet; refuses if the day was closed.
  select * into v_day from app.open_trading_day(v_tenant);

  if exists (select 1 from public.cash_sessions
              where tenant_id = v_tenant and device_id = v_dev and status = 'open') then
    raise exception 'this till is already open';
  end if;

  -- Two devices opening a till at the same instant would both read the same max and
  -- mint the same service_no; serialize per day (audit #9). The unique index below is
  -- the hard backstop.
  perform pg_advisory_xact_lock(hashtextextended(v_day.id::text, 0));
  select coalesce(max(service_no), 0) + 1 into v_no
    from public.cash_sessions where trading_day_id = v_day.id;

  insert into public.cash_sessions (tenant_id, device_id, opened_by, opening_float, trading_day_id, service_no)
  values (v_tenant, v_dev, app.current_app_user_id(), p_opening_float, v_day.id, v_no)
  returning * into v_sess;

  return v_sess;
end $function$

;

-- ── #5: atomic claim so two overlapping campaign sends can't double-bill Meta ──
-- The old path SELECTed pending recipients then sent, flipping status only after —
-- so two concurrent invocations read the SAME pending rows and messaged every
-- customer twice. This claims a disjoint batch (FOR UPDATE SKIP LOCKED) and flips it
-- to 'sending' BEFORE returning, and recovers rows a crashed send stranded there.
create or replace function public.claim_campaign_batch(p_campaign_id uuid, p_limit int)
returns setof public.campaign_recipients
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner');

  -- A send that died mid-flight leaves rows in 'sending'; after 5 min assume it's dead
  -- and return them to the queue so they are not lost.
  update public.campaign_recipients
     set status = 'pending'
   where tenant_id = v_tenant and campaign_id = p_campaign_id
     and status = 'sending' and updated_at < now() - interval '5 minutes';

  return query
  update public.campaign_recipients r
     set status = 'sending', updated_at = now()
   where r.id in (
     select id from public.campaign_recipients
      where tenant_id = v_tenant and campaign_id = p_campaign_id and status = 'pending'
      order by created_at
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning r.*;
end $function$;
