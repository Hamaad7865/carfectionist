-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — till integrity (the ground the Cashmag close will stand on)
--
-- Four defects in how the drawer is accounted for today. They are fixed together
-- because fixing any one alone makes another worse.
--
-- 1. A REFUND REWRITES A CLOSED TILL. reverse_payment stamps the mirror row with
--    the ORIGINAL payment's session and then updates that session's expected_cash
--    and variance. Refund yesterday's cash today and yesterday's till — counted,
--    signed off, printed — silently becomes short, while today's drawer (which is
--    the one the money actually left) still balances. Cashmag books the refund in
--    the service where it HAPPENS: the owner's own slip shows the −660 JUICE in
--    Service 2, not back in Service 1.
--
--    So a payment row now carries TWO sessions:
--      cash_session_id   — the till that took the original money (traceability)
--      booked_session_id — the till the row was ENTERED in (the drawer it moves)
--    For every row that exists today they are the same, so every historical number
--    is byte-identical after this migration. Only a reversal can make them differ.
--
-- 2. A CLOSED TILL IS NOT LOCKED. cash_sessions grants update/delete to every
--    authenticated user and has no append-only trigger (payments and till_movements
--    both do). A counted, closed drawer can be edited from a client.
--
-- 3. CASH CAN BE TAKEN WITH NO TILL. record_payment's p_cash_session_id is optional
--    even for cash, so a cash payment can exist that no close will ever see. The
--    old close_period even had an "unattributed" bucket — proof it happens.
--
-- 4. (fixed in the web, this migration is what makes it safe) The back office picked
--    an open till with `.limit(1)` and no device filter — with two tablets open, a
--    web cash payment landed in a RANDOM till and corrupted both cash-ups.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Where a payment row was BOOKED ───────────────────────────────────────
alter table public.payments
  add column if not exists booked_session_id uuid references public.cash_sessions(id);

comment on column public.payments.booked_session_id is
  'The till this row was entered in — the drawer it actually moves. Equals cash_session_id for a normal payment; for a reversal it is the till the refund was paid OUT of, while cash_session_id still points at the till that took the original money.';

-- Backfill: identical to cash_session_id, so no historical figure changes.
-- payments is append-only (trg_payments_append_only → app.forbid_mutation), so the
-- trigger has to stand aside for the backfill — exactly as lifecycle_hardening does.
alter table public.payments disable trigger trg_payments_append_only;
update public.payments
   set booked_session_id = cash_session_id
 where booked_session_id is distinct from cash_session_id;
alter table public.payments enable trigger trg_payments_append_only;

create index if not exists idx_payments_booked_session
  on public.payments(booked_session_id) where booked_session_id is not null;

-- ── 2. A closed till is final ───────────────────────────────────────────────
-- Writes go through the RPCs (security definer), so the client needs no write grant.
revoke insert, update, delete on public.cash_sessions from authenticated;

create or replace function app.forbid_closed_session_write() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a cash session cannot be deleted — it is the record of a counted drawer';
  end if;
  if old.status = 'closed' then
    raise exception 'this till is closed — its count cannot be changed (%).', old.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_cash_sessions_closed_final on public.cash_sessions;
create trigger trg_cash_sessions_closed_final
  before update or delete on public.cash_sessions
  for each row execute function app.forbid_closed_session_write();

-- ── 3. Cash is always taken on a till ───────────────────────────────────────
-- Same signature (never overload: PostgREST cannot choose between candidates).
create or replace function public.record_payment(
  p_invoice_id uuid,
  p_method payment_method,
  p_amount numeric,
  p_tendered numeric default null::numeric,
  p_external_ref text default null::text,
  p_cash_session_id uuid default null::uuid,
  p_payment_id uuid default null::uuid,
  p_idempotency_key text default null::text
) returns payments language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
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

  -- Cash moves a physical drawer, so it must be taken ON a till. Without this a cash
  -- payment can exist that no cash-up will ever see, and the drawer is short with no
  -- trace of why.
  if p_method = 'cash' and p_cash_session_id is null then
    raise exception 'a cash payment must be taken on an open till — open the till first';
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
    (id, tenant_id, document_id, method, amount, tendered, change_given, external_ref,
     cash_session_id, booked_session_id, received_by)
  values
    (coalesce(p_payment_id, gen_random_uuid()), v_tenant, p_invoice_id, p_method, p_amount,
     p_tendered, v_change, p_external_ref,
     p_cash_session_id, p_cash_session_id, v_actor)
  returning * into v_pay;

  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = p_invoice_id;
  update public.documents
     set amount_paid = v_paid,
         status = (case when v_paid >= total_incl then 'paid' else 'partly_paid' end)::doc_status
   where id = p_invoice_id;

  -- Collection is the handover: a READY job whose bill is now settled in full
  -- moves to delivered — the customer paid and drove off.
  if v_paid >= v_doc.total_incl and v_doc.job_id is not null then
    update public.jobs
       set status = 'delivered', delivered_at = now()
     where id = v_doc.job_id and tenant_id = v_tenant and status = 'ready';
    if found then
      insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
      values (v_tenant, v_actor, 'job_delivered', 'job', v_doc.job_id,
              jsonb_build_object('invoice', v_doc.number, 'via', 'payment collected'));
    end if;
  end if;

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (tenant_id, key, rpc, result)
    values (v_tenant, p_idempotency_key, 'record_payment', jsonb_build_object('payment_id', v_pay.id))
    on conflict (tenant_id, key) do nothing;
  end if;

  return v_pay;
end $function$;

-- ── 4. A refund is booked where it happens ──────────────────────────────────
-- Drop first: adding a defaulted parameter to the old signature would leave TWO
-- candidates and PostgREST would refuse to choose ("could not choose the best
-- candidate function"), bricking every refund in the shop.
drop function if exists public.reverse_payment(uuid, text);

create function public.reverse_payment(
  p_payment_id uuid,
  p_reason text default null::text,
  p_session_id uuid default null::uuid   -- the till the refund is paid OUT of
) returns payments language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
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

  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = v_orig.document_id;
  select * into v_doc from public.documents where id = v_orig.document_id;
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
end $function$;

-- ── 5. The cash-up counts the drawer it actually is ─────────────────────────
-- Sums by booked_session_id: the rows that moved THIS drawer. Identical to the old
-- arithmetic for every row that exists today (booked = taken), and correct for a
-- refund of an older service.
create or replace function public.close_cash_session(p_id uuid, p_closing_count numeric)
returns cash_sessions language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_sess public.cash_sessions;
  v_cash numeric;
  v_moves numeric;
  v_expected numeric;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');
  select * into v_sess from public.cash_sessions where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'cash session not found'; end if;
  if v_sess.status = 'closed' then return v_sess; end if;
  if p_closing_count is null or p_closing_count < 0 then
    raise exception 'count the drawer before closing';
  end if;

  select coalesce(sum(amount),0) into v_cash
    from public.payments
   where booked_session_id = p_id and method = 'cash';
  select coalesce(sum(amount),0) into v_moves
    from public.till_movements where cash_session_id = p_id;

  v_expected := v_sess.opening_float + v_cash + v_moves;

  update public.cash_sessions set
    status = 'closed', closed_by = app.current_app_user_id(), closed_at = now(),
    closing_count = p_closing_count, expected_cash = v_expected,
    variance = p_closing_count - v_expected
  where id = p_id returning * into v_sess;
  return v_sess;
end $function$;
