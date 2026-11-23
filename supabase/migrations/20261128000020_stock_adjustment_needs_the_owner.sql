-- A manual stock adjustment needs the owner.
--
-- An owner adjusts as before. Anyone else (manager or cashier, web Inventory or tablet Stock)
-- needs the owner's PIN for THAT adjustment: the owner approves through /api/override, which
-- records a single-use owner_overrides row (kind 'stock_adjustment', ref = the product, scope =
-- the exact location and quantity), and public.record_stock_adjustment consumes it while writing
-- the movement. One approval moves one product, at one location, by one quantity, once — and only
-- for a short while after it was given, so an abandoned approval cannot be picked up later.
--
-- The ledger's direct INSERT door narrows to the owner, so a manager can no longer step round the
-- PIN by writing the row themselves. Every other movement (sales, POs, transfers, the product
-- import) is written by SECURITY DEFINER functions and is untouched.

alter table public.owner_overrides drop constraint owner_overrides_kind_check;
alter table public.owner_overrides add constraint owner_overrides_kind_check
  check (kind in ('discount', 'reversal', 'stock_adjustment'));
alter table public.owner_overrides drop constraint owner_overrides_ref_type_check;
alter table public.owner_overrides add constraint owner_overrides_ref_type_check
  check (ref_type in ('document', 'payment', 'product'));

create or replace function public.record_stock_adjustment(
  p_product_id uuid, p_location_id uuid, p_qty numeric, p_note text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_role   text := app.current_user_role()::text;
  v_cost   numeric;
  v_over   public.owner_overrides;
  v_id     uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'stock adjustments are not open to this role';
  end if;
  if p_qty is null or p_qty = 0 then raise exception 'quantity change can''t be zero'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'a reason is required for a manual stock adjustment'; end if;

  select cost_price into v_cost from public.products where id = p_product_id and tenant_id = v_tenant;
  if not found then raise exception 'unknown product'; end if;
  if not exists (select 1 from public.stock_locations where id = p_location_id and tenant_id = v_tenant) then
    raise exception 'unknown location';
  end if;

  if v_role <> 'owner' then
    select * into v_over from public.owner_overrides
     where tenant_id = v_tenant and kind = 'stock_adjustment'
       and ref_type = 'product' and ref_id = p_product_id and consumed_at is null
       and created_at > now() - interval '15 minutes'
       and scope->>'location_id' = p_location_id::text
       and (scope->>'qty')::numeric = p_qty
     order by created_at limit 1
     for update;
    if not found then raise exception 'stock adjustment requires the owner'; end if;
    update public.owner_overrides set consumed_at = now() where id = v_over.id;
  end if;

  insert into public.stock_movements (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, created_by, note)
  values (v_tenant, p_product_id, p_location_id, p_qty, coalesce(v_cost, 0), 'adjustment', null,
          app.current_app_user_id(), btrim(p_note))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.record_stock_adjustment(uuid, uuid, numeric, text) from public;
revoke execute on function public.record_stock_adjustment(uuid, uuid, numeric, text) from anon;
grant  execute on function public.record_stock_adjustment(uuid, uuid, numeric, text) to authenticated;

drop policy if exists sm_insert on public.stock_movements;
create policy sm_insert on public.stock_movements for insert to authenticated
  with check (
    tenant_id = (select app.current_tenant_id())
    and ref_type = 'adjustment'::movement_ref_type
    and (select app.current_user_role()) = 'owner'::user_role
  );
