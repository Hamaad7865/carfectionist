-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration 0004 (operations RPCs)
-- Cash sessions, stock transfers, PO receiving, job completion — the
-- back-office equivalents of the POS operational flows. All SECURITY DEFINER,
-- tenant-resolved, and event-sourced (stock via INSERT-only movements).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Cash sessions ───────────────────────────────────────────────────────────
create or replace function public.open_cash_session(p_device_id text, p_opening_float numeric)
returns public.cash_sessions language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tenant uuid := app.current_tenant_id(); v_row public.cash_sessions;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');
  insert into public.cash_sessions (tenant_id, device_id, opened_by, opening_float, status)
  values (v_tenant, coalesce(nullif(p_device_id,''),'back-office'), app.current_app_user_id(), p_opening_float, 'open')
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.close_cash_session(p_id uuid, p_closing_count numeric)
returns public.cash_sessions language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_sess public.cash_sessions;
  v_cash numeric;
  v_expected numeric;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');
  select * into v_sess from public.cash_sessions where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'cash session not found'; end if;
  if v_sess.status = 'closed' then return v_sess; end if;

  select coalesce(sum(amount),0) into v_cash
  from public.payments where cash_session_id = p_id and method = 'cash';
  v_expected := v_sess.opening_float + v_cash;

  update public.cash_sessions set
    status = 'closed', closed_by = app.current_app_user_id(), closed_at = now(),
    closing_count = p_closing_count, expected_cash = v_expected, variance = p_closing_count - v_expected
  where id = p_id returning * into v_sess;
  return v_sess;
end $$;

-- ─── Stock transfers ─────────────────────────────────────────────────────────
create or replace function public.dispatch_transfer(p_id uuid)
returns public.stock_transfers language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tenant uuid := app.current_tenant_id(); v_t public.stock_transfers;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');
  select * into v_t from public.stock_transfers where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'transfer not found'; end if;
  if v_t.status <> 'draft' then raise exception 'transfer already dispatched'; end if;

  insert into public.stock_movements (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, ref_line_id, created_by, note)
  select v_tenant, l.product_id, v_t.from_location_id, -l.qty_dispatched, p.cost_price, 'transfer', v_t.id, l.id, app.current_app_user_id(), 'transfer out'
  from public.stock_transfer_lines l join public.products p on p.id = l.product_id
  where l.transfer_id = v_t.id;

  update public.stock_transfers set status = 'dispatched', dispatched_at = now(), dispatched_by = app.current_app_user_id()
  where id = p_id returning * into v_t;
  return v_t;
end $$;

create or replace function public.receive_transfer(p_id uuid, p_lines jsonb)
returns public.stock_transfers language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tenant uuid := app.current_tenant_id(); v_t public.stock_transfers; r record;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');
  select * into v_t from public.stock_transfers where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'transfer not found'; end if;
  if v_t.status <> 'dispatched' then raise exception 'transfer is not in transit'; end if;

  for r in select (e->>'line_id')::uuid as line_id, (e->>'qty_received')::numeric as qty
           from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) e loop
    update public.stock_transfer_lines set qty_received = r.qty where id = r.line_id and transfer_id = v_t.id;
    insert into public.stock_movements (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, ref_line_id, created_by, note)
    select v_tenant, l.product_id, v_t.to_location_id, r.qty, p.cost_price, 'transfer', v_t.id, l.id, app.current_app_user_id(), 'transfer in'
    from public.stock_transfer_lines l join public.products p on p.id = l.product_id
    where l.id = r.line_id and r.qty > 0;
  end loop;

  update public.stock_transfers set status = 'received', received_at = now(), received_by = app.current_app_user_id()
  where id = p_id returning * into v_t;
  return v_t;
end $$;

-- ─── Purchase order receiving (fires purchase movements + last-cost update) ───
create or replace function public.receive_purchase_order(p_id uuid, p_location uuid, p_lines jsonb)
returns public.purchase_orders language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tenant uuid := app.current_tenant_id(); v_po public.purchase_orders; r record; v_remaining numeric;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');
  select * into v_po from public.purchase_orders where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'purchase order not found'; end if;
  if v_po.status = 'received' then return v_po; end if;

  for r in select (e->>'line_id')::uuid as line_id, (e->>'qty')::numeric as qty
           from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) e loop
    if r.qty > 0 then
      insert into public.stock_movements (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, ref_line_id, created_by, note)
      select v_tenant, pl.product_id, coalesce(p_location, (select id from public.stock_locations where tenant_id = v_tenant and is_default limit 1)),
             r.qty, pl.unit_cost, 'purchase_order', v_po.id, null, app.current_app_user_id(), 'PO receipt'
      from public.purchase_order_lines pl where pl.id = r.line_id;

      update public.purchase_order_lines set qty_received = qty_received + r.qty where id = r.line_id;
      update public.products p set cost_price = pl.unit_cost
      from public.purchase_order_lines pl where pl.id = r.line_id and p.id = pl.product_id;
    end if;
  end loop;

  select coalesce(sum(qty_ordered - qty_received),0) into v_remaining from public.purchase_order_lines where purchase_order_id = v_po.id;
  update public.purchase_orders set status = case when v_remaining <= 0 then 'received' else 'partially_received' end, received_at = now()
  where id = p_id returning * into v_po;
  return v_po;
end $$;

-- ─── Job completion (fires consumption movements from the recipe/confirmed qtys)
create or replace function public.complete_job(p_job_id uuid, p_location uuid, p_consumptions jsonb)
returns public.jobs language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tenant uuid := app.current_tenant_id(); v_job public.jobs; v_loc uuid; r record;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier','technician');
  select * into v_job from public.jobs where id = p_job_id and tenant_id = v_tenant for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status not in ('scheduled','in_progress') then raise exception 'job already completed (status %)', v_job.status; end if;

  v_loc := coalesce(p_location, (select id from public.stock_locations where tenant_id = v_tenant and is_default limit 1));
  for r in select (e->>'product_id')::uuid as pid, (e->>'qty')::numeric as qty
           from jsonb_array_elements(coalesce(p_consumptions,'[]'::jsonb)) e loop
    if r.qty > 0 then
      insert into public.stock_movements (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, created_by, note)
      select v_tenant, r.pid, v_loc, -r.qty, p.cost_price, 'job_card', v_job.id, app.current_app_user_id(), 'job consumption'
      from public.products p where p.id = r.pid;
    end if;
  end loop;

  update public.jobs set status = 'ready', ready_at = now() where id = p_job_id returning * into v_job;
  return v_job;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.open_cash_session(text, numeric)',
    'public.close_cash_session(uuid, numeric)',
    'public.dispatch_transfer(uuid)',
    'public.receive_transfer(uuid, jsonb)',
    'public.receive_purchase_order(uuid, uuid, jsonb)',
    'public.complete_job(uuid, uuid, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
