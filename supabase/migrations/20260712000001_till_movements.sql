-- ═══════════════════════════════════════════════════════════════════════════
-- Manual petty cash (owner request, Cashmag parity: the CASH outflow rows of
-- type "Autre" — "bross pavage, crest, pinkie", "REGUL_SERVICE" — made at the
-- caisse). Staff take cash OUT of an open till for small purchases, with a
-- reason; the drawer's expected cash shrinks accordingly.
--   • till_movements — append-only signed ledger per cash session (negative =
--     cash out; positive reserved for future paid-ins). Corrections are new
--     opposite rows, never edits.
--   • record_till_cash_out RPC — the only write path (open session, positive
--     amount stored negative, reason required, cannot exceed the cash in the
--     drawer). Audited with the device stamp for the Traceability feed.
--   • close_cash_session / reverse_payment — expected cash now includes till
--     movements: float + cash payments + movements.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists till_movements (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references business_settings(id),
  cash_session_id uuid not null references cash_sessions(id),
  amount          numeric(12,2) not null check (amount <> 0), -- negative = out
  reason          text not null check (length(trim(reason)) > 0),
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_till_movements_session on till_movements(tenant_id, cash_session_id);
create trigger trg_till_movements_append_only before update or delete on till_movements
  for each row execute function app.forbid_mutation();

alter table till_movements enable row level security;
create policy tm_select on till_movements for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
grant select on till_movements to authenticated;  -- writes only via the RPC

-- ─── record_till_cash_out ────────────────────────────────────────────────────
create or replace function public.record_till_cash_out(
  p_session_id uuid,
  p_amount numeric,
  p_reason text,
  p_idempotency_key text default null
) returns public.till_movements language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_sess   public.cash_sessions;
  v_cash   numeric;
  v_moves  numeric;
  v_row    public.till_movements;
  v_existing uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'a reason is required'; end if;

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || p_idempotency_key)::bigint);
    select (result->>'till_movement_id')::uuid into v_existing
      from public.idempotency_keys where tenant_id = v_tenant and key = p_idempotency_key;
    if v_existing is not null then
      select * into v_row from public.till_movements where id = v_existing; return v_row;
    end if;
  end if;

  select * into v_sess from public.cash_sessions
   where id = p_session_id and tenant_id = v_tenant for update;
  if not found then raise exception 'cash session not found'; end if;
  if v_sess.status <> 'open' then raise exception 'the till is not open'; end if;

  -- Never take out more than the drawer holds: float + cash payments + prior movements.
  select coalesce(sum(amount),0) into v_cash
    from public.payments where cash_session_id = p_session_id and method = 'cash';
  select coalesce(sum(amount),0) into v_moves
    from public.till_movements where cash_session_id = p_session_id;
  if p_amount > v_sess.opening_float + v_cash + v_moves then
    raise exception 'only % is in the drawer', v_sess.opening_float + v_cash + v_moves;
  end if;

  insert into public.till_movements (tenant_id, cash_session_id, amount, reason, created_by)
  values (v_tenant, p_session_id, -p_amount, trim(p_reason), v_actor)
  returning * into v_row;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload, device_id)
  values (v_tenant, v_actor, 'till_cash_out', 'till_movement', v_row.id,
          jsonb_build_object('amount', p_amount, 'reason', trim(p_reason), 'session_id', p_session_id),
          v_sess.device_id);

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (tenant_id, key, rpc, result)
    values (v_tenant, p_idempotency_key, 'record_till_cash_out', jsonb_build_object('till_movement_id', v_row.id))
    on conflict (tenant_id, key) do nothing;
  end if;

  return v_row;
end $$;
revoke execute on function public.record_till_cash_out(uuid, numeric, text, text) from public;
grant  execute on function public.record_till_cash_out(uuid, numeric, text, text) to authenticated;

-- ─── close_cash_session — expected now includes till movements ──────────────
create or replace function public.close_cash_session(p_id uuid, p_closing_count numeric)
returns public.cash_sessions language plpgsql security definer set search_path = public, pg_temp as $$
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

  select coalesce(sum(amount),0) into v_cash
  from public.payments where cash_session_id = p_id and method = 'cash';
  select coalesce(sum(amount),0) into v_moves
  from public.till_movements where cash_session_id = p_id;
  v_expected := v_sess.opening_float + v_cash + v_moves;

  update public.cash_sessions set
    status = 'closed', closed_by = app.current_app_user_id(), closed_at = now(),
    closing_count = p_closing_count, expected_cash = v_expected, variance = p_closing_count - v_expected
  where id = p_id returning * into v_sess;
  return v_sess;
end $$;

-- ─── reverse_payment — closed-session recompute includes till movements ─────
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

  -- Refresh a CLOSED session's stored reconciliation (now incl. till movements).
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
          jsonb_build_object('reason', p_reason, 'amount', v_orig.amount,
                             'document_id', v_orig.document_id, 'method', v_orig.method));

  return v_mirror;
end $$;
