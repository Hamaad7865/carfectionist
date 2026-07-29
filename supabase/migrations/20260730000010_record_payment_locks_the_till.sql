-- ═══════════════════════════════════════════════════════════════════════════
-- Stop a payment slipping through the gap while the till is being closed.
--
-- record_payment checked the session was open with a plain read and took no lock.
-- close_service locks the session FOR UPDATE and only then sums the drawer. So a
-- payment could read "open", the close could commit, and the payment could land
-- afterwards against a session already summed and sealed — real money, invoice
-- marked paid, absent from every Z-report, and a closed session cannot be edited
-- by design. The drawer reads short and nothing on paper says why.
--
-- The body below is the LIVE function verbatim (as at 2026-07-29, after
-- 20260716000040_till_gate_all_methods) with exactly one change: the session
-- check now takes FOR SHARE. Nothing else about the money path is touched.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.record_payment(p_invoice_id uuid, p_method payment_method, p_amount numeric, p_tendered numeric DEFAULT NULL::numeric, p_external_ref text DEFAULT NULL::text, p_cash_session_id uuid DEFAULT NULL::uuid, p_payment_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      select * into v_pay from public.payments where id = v_existing;
      if v_pay.document_id is distinct from p_invoice_id then
        raise exception 'idempotency key was already used for a different invoice';
      end if;
      return v_pay;
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

  -- EVERY payment is taken ON an open till — money belongs to a service. Cash
  -- because it moves a physical drawer; card/Juice/bank because a payment booked
  -- to no session appears on no Z-report ever (the day counted its ticket while
  -- the means-of-payment split silently lost the money).
  if p_cash_session_id is null then
    raise exception 'a % payment must be taken on an open till — open the till first', p_method;
  end if;
  -- FOR SHARE, not a bare read: close_service takes FOR UPDATE on this same row before it
  -- sums the drawer, so a shared lock here makes the two order themselves. Without it the
  -- window is real — this transaction reads the session as open, the close commits, and then
  -- this payment lands against a session already summed and sealed. The money is genuinely
  -- taken and the invoice says paid, but no Z-report will ever contain it and a closed
  -- session cannot be reopened, so the drawer is short for good with nothing to explain it.
  --
  -- Shared, so concurrent payments on one till still run in parallel; only a close waits.
  -- If the close wins the race, READ COMMITTED re-checks this row against the committed
  -- version, the status = 'open' filter no longer matches, and the cashier is told the till
  -- is closed — which is recoverable. Losing the money silently is not.
  perform 1 from public.cash_sessions
   where id = p_cash_session_id and tenant_id = v_tenant and status = 'open'
   for share;
  if not found then raise exception 'unknown or closed cash session'; end if;

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
end $function$

