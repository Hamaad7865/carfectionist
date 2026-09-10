-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — client signature at quote acceptance
-- The customer signs on the tablet before "Create job"; the POS uploads the
-- PNG to the private vehicle-photos bucket (tenant-first path rule) and hands
-- the path to convert_quote_to_job, which stamps it onto the quote IN THE SAME
-- TRANSACTION as the acceptance — a quote can never read 'accepted with
-- signature' without the acceptance itself having happened, and vice versa.
--
-- documents.accepted_signature jsonb: { "path": <storage path>, "name": <who
-- signed>, "at": <server timestamp> }. Server stamps 'at' — the tablet clock
-- is not an authority. The web back office may still accept without a
-- signature (owner override); the tablet UI requires one.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.documents add column if not exists accepted_signature jsonb;
comment on column public.documents.accepted_signature is
  'Client signature captured at acceptance: {path, name, at} — path in vehicle-photos';

-- Signature change (new defaulted param) would otherwise create an overload.
drop function if exists public.convert_quote_to_job(uuid, uuid, timestamptz);

create or replace function public.convert_quote_to_job(
  p_quote_id uuid,
  p_technician_id uuid,
  p_scheduled_at timestamptz default null,
  p_signature jsonb default null
) returns public.jobs language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_actor   uuid := app.current_app_user_id();
  v_q       public.documents;
  v_job     public.jobs;
  v_service text;
  v_sig     jsonb := case when p_signature is null then null
                          else p_signature || jsonb_build_object('at', now()) end;
  r         jsonb;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents
   where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;

  -- Idempotent: already converted — hand back the same job, but back-fill the
  -- signature if the first accept's response was lost before the client saw it.
  select * into v_job from public.jobs
   where source_quote_id = v_q.id and tenant_id = v_tenant;
  if found then
    if v_sig is not null and v_q.accepted_signature is null then
      update public.documents set accepted_signature = v_sig where id = v_q.id;
    end if;
    return v_job;
  end if;

  if v_q.customer_id is null then raise exception 'this quote has no customer — add one before starting a job'; end if;
  if v_q.vehicle_id  is null then raise exception 'this quote has no vehicle — add one before starting a job'; end if;
  if p_technician_id is not null and not exists (
    select 1 from public.app_users where id = p_technician_id and tenant_id = v_tenant
  ) then raise exception 'unknown technician'; end if;

  if v_q.status = 'draft' then
    select * into v_q from public.issue_document(v_q.id, null, 'quote-accept:' || v_q.id);
  elsif v_q.status <> 'issued' then
    raise exception 'this quote is % and cannot be converted to a job', v_q.status;
  end if;

  select title into v_service from public.document_lines
   where document_id = v_q.id order by sort_order limit 1;

  insert into public.jobs
    (tenant_id, customer_id, vehicle_id, technician_id, scheduled_at, notes,
     status, checklist, damage_markers, source_quote_id, created_by)
  values
    (v_tenant, v_q.customer_id, v_q.vehicle_id, p_technician_id, p_scheduled_at,
     coalesce(nullif(btrim(v_service), ''), 'From quote ' || v_q.number), 'scheduled',
     '[{"label":"Intake photos & damage check","done":false},{"label":"Wash & prep","done":false},{"label":"Service work","done":false},{"label":"Final inspection","done":false}]'::jsonb,
     coalesce(v_q.intake->'markers', '[]'::jsonb),
     v_q.id, v_actor)
  returning * into v_job;

  for r in select value from jsonb_array_elements(coalesce(v_q.intake->'photos', '[]'::jsonb)) loop
    if nullif(r->>'path', '') is not null then
      insert into public.job_photos (tenant_id, job_id, storage_path, caption, phase, created_by)
      values (v_tenant, v_job.id, r->>'path', nullif(r->>'caption', ''), 'before', v_actor);
    end if;
  end loop;

  update public.documents
     set status = 'accepted', job_id = v_job.id,
         accepted_signature = coalesce(v_sig, accepted_signature)
   where id = v_q.id;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'quote_converted_to_job', 'document', v_q.id,
          jsonb_build_object('job_id', v_job.id, 'quote_number', v_q.number,
                             'signed', v_sig is not null));

  return v_job;
end $$;

revoke execute on function public.convert_quote_to_job(uuid, uuid, timestamptz, jsonb) from public;
grant  execute on function public.convert_quote_to_job(uuid, uuid, timestamptz, jsonb) to authenticated;


-- Folded in from 202607120000015_till_movements.sql (history repair 2026-09-10): that version stamp collided and the Supabase CLI cannot match 15-digit versions, so the two files ship as one. Applied out-of-band before this repair; already live. Do not split apart.

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
drop trigger if exists trg_till_movements_append_only on till_movements;
create trigger trg_till_movements_append_only before update or delete on till_movements
  for each row execute function app.forbid_mutation();

alter table till_movements enable row level security;
drop policy if exists tm_select on till_movements;
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
