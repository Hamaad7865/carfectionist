-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — EVERY payment lands on an open till
--
-- Cashmag's model, chosen by the owner: money belongs to a service. Cash was
-- already gated (it moves a physical drawer); card/Juice/bank were not — and a
-- non-cash payment taken with no open till got booked_session_id NULL, which
-- app.z_totals' means-of-payment/cashier split (keyed strictly on
-- booked_session_id) never shows on ANY Z-report, service or day, ever — while
-- the ticket itself still counted in the day's totals. It could even be
-- recorded after the day was closed. Real money, invisible on the cash-up.
--
-- The web back office is unaffected in practice: backOfficeTillId() already
-- opens the desk till on demand before recording. The tablet pad now greys the
-- pay button for every method until a till is open (it did this for cash).
--
-- Body byte-identical to the live record_payment (20260716000030) except the
-- generalized gate.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.record_payment(p_invoice_id uuid, p_method payment_method, p_amount numeric, p_tendered numeric default null::numeric, p_external_ref text default null::text, p_cash_session_id uuid default null::uuid, p_payment_id uuid default null::uuid, p_idempotency_key text default null::text)
returns payments language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
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
  if not exists (
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
