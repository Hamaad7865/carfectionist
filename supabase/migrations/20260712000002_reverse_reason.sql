-- ═══════════════════════════════════════════════════════════════════════════
-- Reversing a payment now REQUIRES a reason (owner request, 2026-07-12): the
-- owner reads it in Activity, per-device Traceability, and Cash Flow. Identical
-- to the till_movements version of reverse_payment plus the reason guard.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.reverse_payment(p_payment_id uuid, p_reason text default null)
returns public.payments language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_orig   public.payments;
  v_mirror public.payments;
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
    select 1 from public.payments
    where reverses_payment_id = p_payment_id and tenant_id = v_tenant
  ) then
    raise exception 'payment already reversed';
  end if;

  insert into public.payments
    (tenant_id, document_id, method, amount, external_ref, reverses_payment_id, cash_session_id, received_by)
  values
    (v_tenant, v_orig.document_id, v_orig.method, -v_orig.amount,
     v_orig.external_ref, v_orig.id, v_orig.cash_session_id, v_actor)
  returning * into v_mirror;

  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = v_orig.document_id;
  select * into v_doc from public.documents where id = v_orig.document_id;
  update public.documents
     set amount_paid = v_paid,
         status = (case when v_paid >= v_doc.total_incl then 'paid'
                        when v_paid > 0 then 'partly_paid'
                        else 'issued' end)::doc_status
   where id = v_orig.document_id;

  -- Refresh a CLOSED session's stored reconciliation (incl. till movements).
  if v_orig.cash_session_id is not null then
    update public.cash_sessions cs set
      expected_cash = cs.opening_float
        + coalesce((select sum(amount) from public.payments where cash_session_id = cs.id and method = 'cash'), 0)
        + coalesce((select sum(amount) from public.till_movements where cash_session_id = cs.id), 0),
      variance = cs.closing_count - (cs.opening_float
        + coalesce((select sum(amount) from public.payments where cash_session_id = cs.id and method = 'cash'), 0)
        + coalesce((select sum(amount) from public.till_movements where cash_session_id = cs.id), 0))
    where cs.id = v_orig.cash_session_id and cs.tenant_id = v_tenant and cs.status = 'closed';
  end if;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'payment_reversed', 'payment', v_orig.id,
          jsonb_build_object('reason', trim(p_reason), 'amount', v_orig.amount,
                             'document_id', v_orig.document_id, 'method', v_orig.method));

  return v_mirror;
end $$;
