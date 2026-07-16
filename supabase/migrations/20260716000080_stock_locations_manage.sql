-- ═══════════════════════════════════════════════════════════════════════════
-- Stock locations become a thing you can MANAGE (owner: "where can we add
-- warehouse shop etc... more like warehouse 2").
--
-- Two rows have existed since the seed and nothing in the product could touch
-- them. The data model already handled N locations — every stock RPC either
-- takes a location id or falls back to the default — but two things stood in
-- the way of ever adding a third:
--
--  1. THE SELLING FLOOR WAS IDENTIFIED BY ELIMINATION. Half the app called the
--     Shop "the location that isn't the default", the other half matched the
--     literal name 'Shop'. With a third location the first is a coin flip, and
--     the second means RENAMING the Shop silently redirects the till. Neither
--     is a fact about the business, so is_sales_floor makes it one: the till
--     debits the sales floor, and it stays the sales floor whatever you call it.
--
--  2. THERE WAS NO SAFE WAY IN. The generic RLS loop in core.sql gave EVERY
--     authenticated role — technician included — insert/update/delete on this
--     table, with no audit trail. Locations carry invariants (exactly one
--     default, exactly one sales floor, both live, no stranded stock), so they
--     follow the same rule as payments and till_movements: no write policies at
--     all, one RPC that holds the invariants, every change audited.
--
-- is_active is a soft off-switch, needed because a location with movement
-- history can never be deleted (the FK is RESTRICT, and rightly so — it would
-- orphan the ledger). Switching one off requires its stock to be ZERO, so an
-- inactive location is always genuinely empty and hiding it loses nothing.
-- ═══════════════════════════════════════════════════════════════════════════

alter table stock_locations add column if not exists is_active     boolean not null default true;
alter table stock_locations add column if not exists is_sales_floor boolean not null default false;

-- One selling floor per tenant — same shape as the existing is_default index.
create unique index if not exists idx_stock_locations_sales_floor
  on stock_locations(tenant_id) where is_sales_floor;

-- Backfill: the selling floor is whichever location the till already debits,
-- i.e. exactly what resolveShopLocationId() resolves today — name 'Shop' first,
-- else the first non-default row. Encoding today's behaviour, not changing it.
update stock_locations sl set is_sales_floor = true
where sl.id = (
        select l.id from stock_locations l
         where l.tenant_id = sl.tenant_id and not l.is_default
         order by (l.name = 'Shop') desc, l.created_at
         limit 1)
  and not exists (select 1 from stock_locations x where x.tenant_id = sl.tenant_id and x.is_sales_floor);

-- ─── writes leave RLS, exactly like payments and till_movements ──────────────
-- These were created by the generic full-CRUD loop in core.sql:704 and let any
-- signed-in staff member rename or drop a location.
drop policy if exists stock_locations_insert on stock_locations;
drop policy if exists stock_locations_update on stock_locations;
drop policy if exists stock_locations_delete on stock_locations;
-- stock_locations_select stays: everyone needs to read locations to do their job.

-- ─── save_stock_location ────────────────────────────────────────────────────
-- Create (p_id null) or update. Null flags mean "leave alone", so the caller
-- can rename without touching defaults.
create or replace function public.save_stock_location(
  p_id             uuid,
  p_name           text,
  p_is_default     boolean default null,
  p_is_sales_floor boolean default null,
  p_is_active      boolean default null
) returns public.stock_locations
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_actor    uuid := app.current_app_user_id();
  v_role     user_role := app.current_user_role();
  v_row      public.stock_locations;
  v_name     text := trim(coalesce(p_name, ''));
  v_qty      numeric;
  v_creating boolean := p_id is null;
begin
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can manage stock locations';
  end if;
  if v_name = '' then raise exception 'A location needs a name'; end if;
  if length(v_name) > 40 then raise exception 'That name is too long — keep it under 40 characters'; end if;
  -- Case-insensitive, unlike the unique(tenant_id, name) constraint: "shop" and
  -- "Shop" being different places would only ever be a mistake.
  if exists (select 1 from public.stock_locations
              where tenant_id = v_tenant and lower(name) = lower(v_name)
                and (p_id is null or id <> p_id)) then
    raise exception 'There is already a location called %', v_name;
  end if;

  if v_creating then
    -- A new location starts as an ordinary store: live, but neither the default
    -- nor the till's floor until someone says so.
    insert into public.stock_locations (tenant_id, name, is_default, is_sales_floor, is_active)
    values (v_tenant, v_name, false, false, true)
    returning * into v_row;
  else
    select * into v_row from public.stock_locations
      where id = p_id and tenant_id = v_tenant for update;
    if not found then raise exception 'No such location'; end if;
    update public.stock_locations set name = v_name where id = v_row.id returning * into v_row;
  end if;

  -- ── the off-switch ──
  if p_is_active is not null and p_is_active is distinct from v_row.is_active then
    if not p_is_active then
      if v_row.is_default then
        raise exception 'The default location cannot be switched off — make another location the default first';
      end if;
      if v_row.is_sales_floor then
        raise exception 'The till''s location cannot be switched off — point the till at another location first';
      end if;
      select coalesce(sum(qty_on_hand), 0) into v_qty
        from public.stock_on_hand where tenant_id = v_tenant and location_id = v_row.id;
      if v_qty <> 0 then
        raise exception 'Move the % units out of % first — switching it off would strand them', v_qty, v_row.name;
      end if;
    end if;
    update public.stock_locations set is_active = p_is_active where id = v_row.id returning * into v_row;
  end if;

  -- ── the default (where stock lands when nobody names a location) ──
  if p_is_default is not null and p_is_default is distinct from v_row.is_default then
    if not p_is_default then
      raise exception 'Every tenant needs one default location — make another one the default instead of un-setting this';
    end if;
    if not v_row.is_active then raise exception 'Switch % back on before making it the default', v_row.name; end if;
    -- Unset then set: the partial unique index is checked per statement, so the
    -- old default must go first.
    update public.stock_locations set is_default = false where tenant_id = v_tenant and is_default;
    update public.stock_locations set is_default = true where id = v_row.id returning * into v_row;
  end if;

  -- ── the selling floor (what the till debits) ──
  if p_is_sales_floor is not null and p_is_sales_floor is distinct from v_row.is_sales_floor then
    if not p_is_sales_floor then
      raise exception 'The till has to debit somewhere — point it at another location instead of un-setting this';
    end if;
    if not v_row.is_active then raise exception 'Switch % back on before pointing the till at it', v_row.name; end if;
    update public.stock_locations set is_sales_floor = false where tenant_id = v_tenant and is_sales_floor;
    update public.stock_locations set is_sales_floor = true where id = v_row.id returning * into v_row;
  end if;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor,
          case when v_creating then 'location_created' else 'location_updated' end,
          'stock_location', v_row.id,
          jsonb_build_object('name', v_row.name, 'is_default', v_row.is_default,
                             'is_sales_floor', v_row.is_sales_floor, 'is_active', v_row.is_active));
  return v_row;
end $$;

-- ─── delete_stock_location ──────────────────────────────────────────────────
-- Only ever for a location created by mistake. Anything with history is
-- switched off instead — the ledger must keep pointing at a real row.
create or replace function public.delete_stock_location(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_role   user_role := app.current_user_role();
  v_row    public.stock_locations;
begin
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can manage stock locations';
  end if;
  select * into v_row from public.stock_locations where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'No such location'; end if;
  if v_row.is_default     then raise exception 'The default location cannot be deleted'; end if;
  if v_row.is_sales_floor then raise exception 'The till''s location cannot be deleted'; end if;
  if exists (select 1 from public.stock_movements where location_id = p_id) then
    raise exception '% has stock history — switch it off instead of deleting it', v_row.name;
  end if;
  if exists (select 1 from public.stock_transfers
              where from_location_id = p_id or to_location_id = p_id) then
    raise exception '% is used by a stock transfer — switch it off instead of deleting it', v_row.name;
  end if;

  delete from public.stock_locations where id = p_id;
  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'location_deleted', 'stock_location', p_id,
          jsonb_build_object('name', v_row.name));
end $$;

revoke execute on function public.save_stock_location(uuid, text, boolean, boolean, boolean) from public, anon;
grant  execute on function public.save_stock_location(uuid, text, boolean, boolean, boolean) to authenticated;
revoke execute on function public.delete_stock_location(uuid) from public, anon;
grant  execute on function public.delete_stock_location(uuid) to authenticated;
