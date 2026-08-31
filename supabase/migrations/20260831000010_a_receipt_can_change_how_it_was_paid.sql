-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a receipt can change HOW it was paid.
--
-- The card machine is separate from the POS. The cashier taps Card, the slip
-- prints, THEN the PDQ declines it and the customer pays by Juice instead.
-- reverse_payment is the only correction path today and it is owner-only
-- (20260810000060), with a typed reason — so the counter stalls.
--
-- change_payment_method is a NARROW carve-out: it reverses the original line
-- and books a new one for the IDENTICAL amount on the IDENTICAL invoice, in
-- one transaction. amount_paid and status come out unchanged; points and job
-- delivery are never touched — so net money movement is provably zero and a
-- cashier may do it. Changing AWAY FROM cash is the one exception (it removes
-- an expectation of cash in the drawer) and still needs owner|manager.
--
-- Spliced from the LIVE bodies of reverse_payment + record_payment, not the
-- migration files (both have been rebuilt many times).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.change_payment_method(
  p_payment_id       uuid,
  p_new_method       payment_method,
  p_new_external_ref text default null,
  p_session_id       uuid default null,
  p_idempotency_key  text default null
) returns payments
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_actor    uuid := app.current_app_user_id();
  v_orig     public.payments;
  v_doc      public.documents;
  v_session  uuid;
  v_new      public.payments;
  v_new_id   uuid := gen_random_uuid();
  v_tendered numeric;
  v_change   numeric;
  v_paid     numeric;
  v_existing uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  -- ── idempotency: same key ⇒ return the row it already produced ───────────
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || p_idempotency_key)::bigint);
    select (result->>'payment_id')::uuid into v_existing
      from public.idempotency_keys where tenant_id = v_tenant and key = p_idempotency_key;
    if v_existing is not null then
      select * into v_new from public.payments where id = v_existing;
      return v_new;
    end if;
  end if;

  -- ── load + validate the original line ───────────────────────────────────
  select * into v_orig from public.payments
   where id = p_payment_id and tenant_id = v_tenant for update;
  if not found then raise exception 'payment not found'; end if;
  if v_orig.amount <= 0 then raise exception 'cannot change a reversal'; end if;
  if exists (select 1 from public.payments
              where reverses_payment_id = p_payment_id and tenant_id = v_tenant) then
    raise exception 'payment already reversed';
  end if;
  -- 'credit' is a UI pseudo-tender, never a payment_method enum value, so it can
  -- reach neither side: v_orig.method is a real row, p_new_method is enum-typed.
  if v_orig.method = 'points' then
    raise exception 'a points payment cannot have its method changed here';
  end if;
  if p_new_method = 'points' then
    raise exception 'cannot change a payment to points';
  end if;
  if p_new_method = v_orig.method then
    raise exception 'that is already the payment method';
  end if;

  -- Changing AWAY FROM cash removes an expectation of cash in the drawer.
  if v_orig.method = 'cash' then
    perform app.require_role('owner','manager');
  end if;

  select * into v_doc from public.documents
   where id = v_orig.document_id and tenant_id = v_tenant for update;
  if v_doc.status = 'void' then raise exception 'the invoice is void'; end if;
  if exists (
    select 1 from public.documents cn
     where cn.tenant_id = v_tenant and cn.doc_type = 'credit_note'
       and cn.source_document_id = v_orig.document_id and cn.status <> 'void'
  ) then
    raise exception 'this invoice has a credit note — correct it there';
  end if;

  -- ── the till both rows land on: the given session, else the original's
  --    open sibling for the same device (the reverse_payment lookup) ────────
  v_session := p_session_id;
  if v_session is null and v_orig.cash_session_id is not null then
    select s2.id into v_session
      from public.cash_sessions s1
      join public.cash_sessions s2
        on s2.device_id = s1.device_id and s2.tenant_id = s1.tenant_id and s2.status = 'open'
     where s1.id = v_orig.cash_session_id;
  end if;
  if v_session is null then
    raise exception 'the till this was paid on is closed — an owner can still correct it';
  end if;
  perform 1 from public.cash_sessions
   where id = v_session and tenant_id = v_tenant and status = 'open' for share;
  if not found then raise exception 'unknown or closed cash session'; end if;

  -- ── the new method's own rules (from record_payment) ───────────────────
  if p_new_method = 'cash' then
    v_tendered := v_orig.amount;
    v_change   := 0;
  else
    if p_new_external_ref is null and p_new_method <> 'cheque' then
      raise exception 'a % payment requires an external reference', p_new_method;
    end if;
    v_tendered := null;
    v_change   := null;
  end if;

  -- ── negative mirror of the original (reverse_payment shape) ────────────
  insert into public.payments
    (tenant_id, document_id, method, amount, external_ref, reverses_payment_id,
     cash_session_id, booked_session_id, received_by)
  values
    (v_tenant, v_orig.document_id, v_orig.method, -v_orig.amount,
     v_orig.external_ref, v_orig.id,
     v_orig.cash_session_id, v_session, v_actor);

  -- ── the new payment ───────────────────────────────────────────────────
  insert into public.payments
    (id, tenant_id, document_id, method, amount, tendered, change_given, external_ref,
     cash_session_id, booked_session_id, received_by)
  values
    (v_new_id, v_tenant, v_orig.document_id, p_new_method, v_orig.amount,
     v_tendered, v_change, p_new_external_ref,
     v_session, v_session, v_actor)
  returning * into v_new;

  -- ── recompute the invoice (nets to the same figure) ───────────────────
  select coalesce(sum(amount), 0) into v_paid
    from public.payments where document_id = v_orig.document_id;
  update public.documents
     set amount_paid = v_paid,
         status = (case when v_paid >= total_incl then 'paid'
                        when v_paid > 0 then 'partly_paid'
                        else 'issued' end)::doc_status
   where id = v_orig.document_id;

  -- Points and job delivery are deliberately NOT touched: total paid is
  -- unchanged, so both are already correct.

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'payment_method_changed', 'payment', v_orig.id,
          jsonb_build_object(
            'original_payment_id', v_orig.id, 'new_payment_id', v_new.id,
            'from_method', v_orig.method, 'to_method', p_new_method,
            'amount', v_orig.amount, 'invoice', v_doc.number,
            'booked_session', v_session,
            'reason', 'method changed at POS: ' || v_orig.method || ' → ' || p_new_method));

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (tenant_id, key, rpc, result)
    values (v_tenant, p_idempotency_key, 'change_payment_method',
            jsonb_build_object('payment_id', v_new.id))
    on conflict (tenant_id, key) do nothing;
  end if;

  return v_new;
end $function$;

revoke execute on function public.change_payment_method(uuid, payment_method, text, uuid, text) from public;
grant  execute on function public.change_payment_method(uuid, payment_method, text, uuid, text) to authenticated;

-- ── prove it installed ────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.change_payment_method(uuid, payment_method, text, uuid, text)') is null then
    raise exception 'change_payment_method did not install';
  end if;
end $$;
