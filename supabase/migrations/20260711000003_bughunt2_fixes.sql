-- ═══════════════════════════════════════════════════════════════════════════
-- Second bug-hunt fixes (SQL).
--   #1  vat_breakdown must ALWAYS come from the single authority
--       app.discounted_vat_groups() on issue — not just when an order-level
--       discount is present. Line-only discounts were already correct via the
--       generated columns, but relying on a discount-gated trigger left the
--       fiscal snapshot's provenance split across two code paths. Widen the
--       trigger so every issued document (invoice + credit note) snapshots the
--       authoritative per-rate figures. Collapses to the exact line sums when
--       there is no discount, so the canonical 77,200 / 11,580 / 88,780 vector
--       stays byte-identical.
--   #2  receive_transfer closed a transfer as 'received' even when p_lines was
--       empty or omitted dispatched lines — silently vaporising the dispatched
--       stock (a −qty went out at source, no +qty ever came in, and the closed
--       transfer can never be received again). Require every dispatched line to
--       be accounted for (an explicit 0 = genuine in-transit loss) and reject
--       foreign line ids, mirroring receive_purchase_order's guards.
--   #7  reverse_payment left a CLOSED cash session's stored expected_cash /
--       variance stale — the negative mirror carries the session id but the
--       figures were frozen at close. Recompute them so the till reconciliation
--       reflects the reversal.
-- ═══════════════════════════════════════════════════════════════════════════

-- #1 ── vat_breakdown from the single authority on every issue ────────────────
create or replace function app.snapshot_discounted_vat_breakdown() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'issued' and old.status is distinct from 'issued' then
    -- app.discounted_vat_groups is the SINGLE fiscal authority (same source as
    -- recompute_doc_totals). With no discount it returns the exact summed line
    -- columns, so undiscounted documents keep their byte-identical breakdown.
    new.vat_breakdown := (
      select jsonb_agg(jsonb_build_object('rate', rate, 'base', base, 'vat', vat) order by rate)
      from app.discounted_vat_groups(new.id)
    );
  end if;
  return new;
end $$;

-- #2 ── receive_transfer: every dispatched line must be accounted for ─────────
create or replace function public.receive_transfer(p_id uuid, p_lines jsonb)
returns public.stock_transfers language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_t public.stock_transfers;
  r record;
  v_line_count int;
  v_seen_count int;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');
  select * into v_t from public.stock_transfers where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'transfer not found'; end if;
  if v_t.status <> 'dispatched' then raise exception 'transfer is not in transit'; end if;

  -- Every dispatched line must appear in p_lines exactly once. Receiving less
  -- than dispatched is allowed (the gap is genuine in-transit loss), but it must
  -- be an explicit per-line acknowledgement — a missing/empty line would close
  -- the transfer and silently strand its dispatched stock.
  select count(*) into v_line_count
    from public.stock_transfer_lines where transfer_id = v_t.id and tenant_id = v_tenant;
  select count(*) into v_seen_count from (
    select distinct (e->>'line_id')::uuid lid
    from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) e
    where exists (
      select 1 from public.stock_transfer_lines l
      where l.id = (e->>'line_id')::uuid and l.transfer_id = v_t.id and l.tenant_id = v_tenant
    )
  ) s;
  if v_seen_count <> v_line_count then
    raise exception 'every dispatched line must be accounted for before the transfer can be received';
  end if;

  for r in select (e->>'line_id')::uuid as line_id, (e->>'qty_received')::numeric as qty
           from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) e loop
    -- Reject a line that is not on this transfer (a foreign id must not move stock).
    if not exists (
      select 1 from public.stock_transfer_lines l
      where l.id = r.line_id and l.transfer_id = v_t.id and l.tenant_id = v_tenant
    ) then raise exception 'line is not on this transfer'; end if;

    update public.stock_transfer_lines set qty_received = r.qty where id = r.line_id and transfer_id = v_t.id;
    insert into public.stock_movements (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, ref_line_id, created_by, note)
    select v_tenant, l.product_id, v_t.to_location_id, r.qty, p.cost_price, 'transfer', v_t.id, l.id, app.current_app_user_id(), 'transfer in'
    from public.stock_transfer_lines l join public.products p on p.id = l.product_id
    where l.id = r.line_id and l.transfer_id = v_t.id and l.tenant_id = v_tenant and r.qty > 0;
  end loop;

  update public.stock_transfers set status = 'received', received_at = now(), received_by = app.current_app_user_id()
  where id = p_id returning * into v_t;
  return v_t;
end $$;

-- #7 ── reverse_payment: refresh a closed cash session's reconciliation ───────
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

  -- If the reversed payment was tied to an already-closed cash session, its
  -- stored expected_cash/variance were frozen at close and no longer include the
  -- negative mirror. Recompute them exactly as close_cash_session would now.
  if v_orig.cash_session_id is not null then
    update public.cash_sessions cs set
      expected_cash = cs.opening_float + coalesce(
        (select sum(amount) from public.payments where cash_session_id = cs.id and method = 'cash'), 0),
      variance = cs.closing_count - (cs.opening_float + coalesce(
        (select sum(amount) from public.payments where cash_session_id = cs.id and method = 'cash'), 0))
    where cs.id = v_orig.cash_session_id and cs.tenant_id = v_tenant and cs.status = 'closed';
  end if;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'payment_reversed', 'payment', v_orig.id,
          jsonb_build_object('reason', p_reason, 'amount', v_orig.amount,
                             'document_id', v_orig.document_id, 'method', v_orig.method));

  return v_mirror;
end $$;
