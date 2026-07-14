-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — what a closed day refuses, and where a ticket belongs
--
-- issue_document gains p_session_id: the service that rang the ticket. Without it a Z
-- report cannot say which service a sale belongs to, and a day would have to guess from
-- timestamps — which double-counts the moment two tills are open at once.
--
-- This is the LIVE body, unchanged, plus exactly three things: the day guard, the
-- session/business-day stamp, and the new parameter. Everything else — the fiscal
-- snapshot (legal name, BRN, VAT number, bill-to, the frozen vat_breakdown), the
-- idempotency-key ownership check, the line and customer guards, the stock movements —
-- is byte-for-byte what is running today.
--
-- Dropped and recreated rather than overloaded: two candidates and PostgREST refuses to
-- choose ("could not choose the best candidate function"), which would brick every sale.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.issue_document(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.issue_document(
  p_document_id uuid,
  p_stock_location_id uuid DEFAULT NULL::uuid,
  p_idempotency_key text DEFAULT NULL::text,
  p_session_id uuid DEFAULT NULL::uuid      -- the service that rang this ticket
)
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
    business_day       = coalesce(v_doc.business_day, app.mu_today()),
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
end $function$;

-- ── A closed day refuses money ─────────────────────────────────────────────
create or replace function app.guard_day_open() returns trigger
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_closed boolean;
begin
  select d.status = 'closed' into v_closed
    from public.cash_sessions s join public.trading_days d on d.id = s.trading_day_id
   where s.id = new.booked_session_id;
  if coalesce(v_closed, false) then
    raise exception 'the day is closed — no more entries or transactions are possible';
  end if;
  return new;
end $$;

drop trigger if exists trg_payments_day_open on public.payments;
create trigger trg_payments_day_open
  before insert on public.payments
  for each row when (new.booked_session_id is not null)
  execute function app.guard_day_open();

-- ── Backfill: the tills that are open right now join today's day ───────────
-- Sessions opened before this release carry no day. Attach the OPEN ones to today so the
-- shop can close normally tonight. Historical closed sessions are left alone: their Z was
-- never cut and cannot be reconstructed — pretending otherwise would print a plausible
-- but wrong slip.
do $$
declare v_t record; v_day public.trading_days;
begin
  for v_t in select distinct tenant_id from public.cash_sessions where status = 'open' and trading_day_id is null
  loop
    insert into public.trading_days (tenant_id, business_date)
    values (v_t.tenant_id, app.mu_today())
    on conflict (tenant_id, business_date) do nothing;

    select * into v_day from public.trading_days
     where tenant_id = v_t.tenant_id and business_date = app.mu_today();

    update public.cash_sessions s
       set trading_day_id = v_day.id,
           service_no = coalesce(s.service_no, 1)
     where s.tenant_id = v_t.tenant_id and s.status = 'open' and s.trading_day_id is null;
  end loop;
end $$;
