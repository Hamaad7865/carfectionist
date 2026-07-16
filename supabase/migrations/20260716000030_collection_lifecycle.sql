-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — the car leaves the workshop exactly once, paid or owing
--
-- Companion to 20260716000020_deliver_on_account (the on-account handover).
-- Together they close every hole the money-flow audit confirmed around the
-- ready→delivered edge:
--
-- 1) deliver_paid_job — a job whose bill was settled BEFORE it was ready had no
--    path to 'delivered': record_payment only delivers at payment time, and a
--    paid bill never returns to checkout. The job-card's new "Car collected"
--    action calls this.
-- 2) undo_on_account — a mistaken "put it on account" tap was irreversible from
--    the POS (and the old undo VOIDED the fiscal invoice while the job stayed
--    delivered — erasing the receivable for a car that left). This walks the
--    handover back instead: job returns to READY, the bill stays open.
--    jobs_guard gains a transaction-local escape hatch so the same cashier who
--    made the mistake can undo it (the guard otherwise restricts un-delivering
--    to owner/manager).
-- 3) reverse_payment — REGRESSION REPAIR. lifecycle_hardening's "money walked
--    back un-delivers the job" block was silently lost when the function was
--    rewritten for drawer semantics (3-arg, booked_session_id). Restored, with
--    a discriminator the original never needed: only the payment that CAUSED
--    the delivery walks it back (auto-deliver stamps delivered_at with the same
--    transaction timestamp as the payment row). A car handed over on account or
--    collected after prepaying already LEFT — reversing later money must not
--    resurrect it on the READY board.
-- 4) record_payment — REGRESSION REPAIR. The same rewrite dropped the
--    idempotency-replay same-invoice check (a guessable key could hand back a
--    payment that belongs to a different invoice). Restored. Body otherwise
--    byte-identical to the live function (dumped via pg_get_functiondef).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) deliver_paid_job ---------------------------------------------------------
-- The prepaid pickup: bill settled while the car was still being worked on, job
-- now READY, customer at the desk. Nothing is owed, so checkout has nothing to
-- collect — the handover is recorded directly. Locks the invoice before the job
-- (same order as record_payment) so the two can never deadlock.
create or replace function public.deliver_paid_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_doc    public.documents;
  v_job    public.jobs;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  -- The job's one live invoice (idx_invoice_one_per_job guarantees at most one).
  select * into v_doc from public.documents
   where tenant_id = v_tenant and job_id = p_job_id
     and doc_type = 'invoice' and status <> 'void'
   for update;
  if not found then raise exception 'the job has no invoice — bill it first'; end if;
  if v_doc.status <> 'paid' then
    raise exception 'the bill is not settled (status %) — collect at checkout', v_doc.status;
  end if;

  select * into v_job from public.jobs
   where id = p_job_id and tenant_id = v_tenant for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status = 'delivered' then return false; end if; -- double tap: no-op
  if v_job.status <> 'ready' then
    raise exception 'job is not ready for collection (status %)', v_job.status;
  end if;

  update public.jobs
     set status = 'delivered', delivered_at = now()
   where id = p_job_id;
  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'job_delivered', 'job', p_job_id,
          jsonb_build_object('invoice', v_doc.number, 'via', 'collected (paid earlier)'));
  return true;
end $function$;

grant execute on function public.deliver_paid_job(uuid) to authenticated;

-- 2) jobs_guard escape hatch + undo_on_account --------------------------------
-- Identical to the live guard except the un-deliver role check now honours a
-- transaction-local flag that ONLY undo_on_account sets. Clients cannot reach
-- set_config through PostgREST, so the hatch opens exclusively inside that RPC.
create or replace function app.jobs_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role text := (app.current_user_role())::text;
begin
  -- No user context = service role / migrations / backfills: trusted.
  if auth.uid() is null then return new; end if;

  if new.tenant_id       is distinct from old.tenant_id
     or new.customer_id     is distinct from old.customer_id
     or new.vehicle_id      is distinct from old.vehicle_id
     or new.source_quote_id is distinct from old.source_quote_id
     or new.created_at      is distinct from old.created_at then
    raise exception 'job identity columns are immutable';
  end if;

  if new.status is distinct from old.status then
    if not ( (old.status = 'scheduled'   and new.status in ('in_progress','ready','cancelled'))
          or (old.status = 'in_progress' and new.status in ('ready','cancelled'))
          or (old.status = 'ready'       and new.status = 'delivered')
          or (old.status = 'delivered'   and new.status = 'ready') ) then
      raise exception 'illegal job transition: % -> %', old.status, new.status;
    end if;
    if new.status = 'delivered' and v_role not in ('owner','manager','cashier') then
      raise exception 'only owner, manager or cashier can mark a job delivered';
    end if;
    if new.status = 'cancelled' and v_role not in ('owner','manager') then
      raise exception 'only owner or manager can cancel a job';
    end if;
    if old.status = 'delivered' and new.status = 'ready' and v_role not in ('owner','manager')
       and coalesce(current_setting('app.allow_undeliver', true), '') <> '1' then
      raise exception 'only owner or manager can un-deliver a job';
    end if;
  end if;
  return new;
end $$;

-- Walk back a MISTAKEN on-account handover: the job returns to READY, the open
-- invoice is untouched (the receivable never existed as a payment, so there is
-- nothing to reverse). Refuses to touch a delivery that was not on-account —
-- the latest job_delivered audit crumb is the discriminator, and it is written
-- only by our own RPCs.
create or replace function public.undo_on_account(p_invoice_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_doc    public.documents;
  v_job    public.jobs;
  v_via    text;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  -- The cashier who mis-tapped fixes it at the counter — same roles as delivery.
  perform app.require_role('owner','manager','cashier');

  select * into v_doc from public.documents
   where id = p_invoice_id and tenant_id = v_tenant for update;
  if not found then raise exception 'invoice not found'; end if;
  if v_doc.job_id is null then raise exception 'this invoice has no job to walk back'; end if;
  if v_doc.status not in ('issued','partly_paid') then
    raise exception 'the bill has since been settled (status %) — nothing to undo', v_doc.status;
  end if;

  select * into v_job from public.jobs
   where id = v_doc.job_id and tenant_id = v_tenant for update;
  if v_job.status <> 'delivered' then return false; end if; -- already back: no-op

  select payload->>'via' into v_via from public.audit_events
   where tenant_id = v_tenant and ref_type = 'job' and ref_id = v_doc.job_id
     and event_type = 'job_delivered'
   order by created_at desc limit 1;
  if v_via is distinct from 'taken on account' then
    raise exception 'this delivery was not an on-account handover — reverse the payment instead';
  end if;

  perform set_config('app.allow_undeliver', '1', true); -- transaction-local
  update public.jobs
     set status = 'ready', delivered_at = null
   where id = v_doc.job_id;
  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'job_delivery_reversed', 'job', v_doc.job_id,
          jsonb_build_object('invoice', v_doc.number, 'via', 'on-account undo'));
  return true;
end $function$;

grant execute on function public.undo_on_account(uuid) to authenticated;

-- 3) reverse_payment: restore the un-deliver walk-back -------------------------
-- Byte-identical to the live 3-arg function except the restored block after the
-- document status recompute.
create or replace function public.reverse_payment(p_payment_id uuid, p_reason text default null::text, p_session_id uuid default null::uuid)
returns payments language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
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

  -- Money walked back: a job auto-delivered by THIS payment must not stay
  -- "delivered" against a bill no longer settled. The discriminator is the
  -- transaction timestamp — record_payment stamps delivered_at and the payment's
  -- received_at from the same now(), so equality means this payment caused the
  -- delivery. A car that left on account or was collected after prepaying keeps
  -- its delivery: that handover happened at the kerb, not in this ledger.
  -- (Restores the walk-back lost when this function was rewritten; the RPC is
  -- already owner/manager-only, which jobs_guard requires for un-delivering.)
  if v_doc.job_id is not null and v_paid < v_doc.total_incl then
    update public.jobs
       set status = 'ready', delivered_at = null
     where id = v_doc.job_id and tenant_id = v_tenant and status = 'delivered'
       and delivered_at = v_orig.received_at;
    if found then
      insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
      values (v_tenant, v_actor, 'job_delivery_reversed', 'job', v_doc.job_id,
              jsonb_build_object('reason', trim(p_reason), 'invoice', v_doc.number));
    end if;
  end if;

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

-- 4) record_payment: restore the idempotency same-invoice guard ----------------
-- Byte-identical to the live function except the replay now verifies the stored
-- payment belongs to THIS invoice (guessable keys must not hand back another
-- invoice's payment).
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
