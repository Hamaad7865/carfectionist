-- ═══════════════════════════════════════════════════════════════════════════
-- Job consumption comes off the shop floor too, not the bulk store.
--
-- complete_job had the same fallback bug 20260730000060 fixed in issue_document:
-- with no location named, it deducted consumed products from the DEFAULT location
-- (the Warehouse) instead of the sales floor. It has never fired — there are zero
-- job_card movements, because this shop bills products as invoice lines rather than
-- job consumption — but the latent bug is identical, so it is closed the same way
-- for consistency: an automatic deduction leaves the shop floor unless told otherwise.
--
-- Body is the live complete_job verbatim; only the location fallback changed.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.complete_job(p_job_id uuid, p_location uuid, p_consumptions jsonb)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_tenant uuid := app.current_tenant_id(); v_job public.jobs; v_loc uuid; r record;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier','technician');
  select * into v_job from public.jobs where id = p_job_id and tenant_id = v_tenant for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status not in ('scheduled','in_progress') then raise exception 'job already completed (status %)', v_job.status; end if;
  -- FK checks bypass RLS inside a definer fn: validate the client-supplied location.
  if p_location is not null and not exists (
    select 1 from public.stock_locations where id = p_location and tenant_id = v_tenant
  ) then raise exception 'unknown stock location'; end if;
  -- Idempotency at the ledger level (status is a mutable column and not enough):
  -- never consume stock twice for the same job.
  if exists (select 1 from public.stock_movements where tenant_id = v_tenant and ref_type = 'job_card' and ref_id = v_job.id) then
    raise exception 'job already has consumption recorded';
  end if;

  -- Consumables used in the bay come off the SHOP FLOOR, same as a sale — the till and the
  -- workshop both work from the sales-floor stock; the Warehouse is bulk. Mirrors the clients'
  -- pickSalesFloor / fetchShopLocationId, matching issue_document (20260730000060). is_default
  -- is the last resort only, for a one-location shop.
  v_loc := coalesce(
    p_location,
    (select id from public.stock_locations where tenant_id = v_tenant and is_sales_floor order by name limit 1),
    (select id from public.stock_locations where tenant_id = v_tenant and name = 'Shop' order by name limit 1),
    (select id from public.stock_locations where tenant_id = v_tenant and not is_default order by name limit 1),
    (select id from public.stock_locations where tenant_id = v_tenant and is_default limit 1)
  );
  for r in select (e->>'product_id')::uuid as pid, (e->>'qty')::numeric as qty
           from jsonb_array_elements(coalesce(p_consumptions,'[]'::jsonb)) e loop
    if r.qty > 0 then
      insert into public.stock_movements (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, created_by, note)
      select v_tenant, r.pid, v_loc, -r.qty, p.cost_price, 'job_card', v_job.id, app.current_app_user_id(), 'job consumption'
      from public.products p where p.id = r.pid and p.tenant_id = v_tenant;
    end if;
  end loop;

  update public.jobs set status = 'ready', ready_at = now() where id = p_job_id returning * into v_job;
  return v_job;
end $function$
