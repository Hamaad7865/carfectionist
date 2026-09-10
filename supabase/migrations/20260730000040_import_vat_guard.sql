-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration 0040 (import VAT guard)
--
-- import_products stored the sheet's selling_price RAW. This shop quotes
-- VAT-INCLUSIVE shelf prices (business_settings.prices_vat_exclusive = false)
-- and the owner's sheets carry what the customer pays — so every import planted
-- a gross figure in the NET column and the till charged VAT on top of a price
-- that already included it. The 2026-07-30 audit found 23 such rows (one sold:
-- Rs 8,050 taken for a Rs 7,000 product).
--
-- The guard makes the import honour what a price MEANS here, same as the
-- product form: when the shop quotes gross, selling_price converts to net
-- (÷ (1 + rate/100), rate = row's vat_rate → product's → business default).
-- p_prices_incl_vat overrides per call (false = "my file already carries net",
-- e.g. a sheet built from ledger figures) — null derives from settings.
-- cost_price is a supplier figure with no gross/net duality; untouched.
--
-- DROP first: create-or-replace with an added parameter would OVERLOAD, leaving
-- the old unguarded 2-arg function alive for existing web calls.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.import_products(jsonb, boolean);

create or replace function public.import_products(p_rows jsonb, p_dry_run boolean default false, p_prices_incl_vat boolean default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  r jsonb; v_sku text; v_name text; v_id uuid;
  v_ins int := 0; v_upd int := 0; v_skip int := 0; v_stock int := 0; v_errs jsonb := '[]'::jsonb;
  loc record; v_target numeric; v_current numeric;
  v_vat_default numeric; v_incl boolean;
  v_price numeric; v_rate numeric; v_row_rate numeric; v_existing_rate numeric;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

  -- What does a price in this file MEAN? The shop's own declaration, unless the
  -- caller says otherwise. A missing settings row falls back to net-in/net-out —
  -- the no-conversion behaviour every import had before this guard.
  select bs.vat_rate, not bs.prices_vat_exclusive into v_vat_default, v_incl
    from public.business_settings bs where bs.id = v_tenant;
  v_vat_default := coalesce(v_vat_default, 15);
  v_incl := coalesce(p_prices_incl_vat, v_incl, false);

  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_sku  := btrim(coalesce(r->>'sku',''));
    v_name := btrim(coalesce(r->>'name',''));
    v_id   := null;
    begin
      if v_sku <> '' then
        select id into v_id from public.products where tenant_id = v_tenant and sku = v_sku limit 1;
      end if;
      if v_id is null and v_sku = '' and v_name <> '' then
        select id into v_id from public.products where tenant_id = v_tenant and lower(name) = lower(v_name) limit 1;
      end if;

      -- The guard: a gross-quoting shop's sheet carries the SHELF price — store the
      -- net the ledger prices from. Effective rate: this row's, else the product's
      -- own, else the default (mirrors the form). Zero-rated stores as typed.
      v_price    := nullif(btrim(coalesce(r->>'selling_price','')),'')::numeric;
      v_row_rate := nullif(btrim(coalesce(r->>'vat_rate','')),'')::numeric;
      if v_price is not null and v_incl then
        v_existing_rate := null;
        if v_id is not null then
          select vat_rate into v_existing_rate from public.products where id = v_id;
        end if;
        v_rate := coalesce(v_row_rate, v_existing_rate, v_vat_default);
        if v_rate > 0 then
          v_price := round(v_price / (1 + v_rate/100), 2);
        end if;
      end if;

      if v_id is not null then
        v_upd := v_upd + 1;
        if not p_dry_run then
          update public.products set
            name                = coalesce(nullif(v_name,''), name),
            category            = coalesce(nullif(btrim(coalesce(r->>'category','')),''), category),
            barcode             = case when r ? 'barcode' then nullif(btrim(coalesce(r->>'barcode','')),'') else barcode end,
            unit                = coalesce(nullif(btrim(coalesce(r->>'unit','')),'')::product_unit, unit),
            selling_price       = coalesce(v_price, selling_price),
            cost_price          = coalesce(nullif(btrim(coalesce(r->>'cost_price','')),'')::numeric, cost_price),
            vat_rate            = case when v_row_rate is not null then v_row_rate else vat_rate end,
            low_stock_threshold = coalesce(nullif(btrim(coalesce(r->>'low_stock_threshold','')),'')::numeric, low_stock_threshold),
            is_active           = case when r ? 'is_active' then app.csv_bool(r->>'is_active') else is_active end
          where id = v_id;
        end if;
      elsif v_name <> '' then
        v_ins := v_ins + 1;
        if not p_dry_run then
          insert into public.products (tenant_id, sku, name, category, barcode, kind, unit, selling_price, cost_price, vat_rate, is_stocked, low_stock_threshold, is_active)
          values (v_tenant, nullif(v_sku,''), v_name,
            nullif(btrim(coalesce(r->>'category','')),''),
            nullif(btrim(coalesce(r->>'barcode','')),''),
            'product',
            coalesce(nullif(btrim(coalesce(r->>'unit','')),'')::product_unit, 'piece'),
            coalesce(v_price, 0),
            coalesce(nullif(btrim(coalesce(r->>'cost_price','')),'')::numeric, 0),
            v_row_rate,
            true,
            coalesce(nullif(btrim(coalesce(r->>'low_stock_threshold','')),'')::numeric, 5),
            case when r ? 'is_active' then app.csv_bool(r->>'is_active') else true end)
          returning id into v_id;
        end if;
      else
        v_skip := v_skip + 1;
        continue;
      end if;

      -- stock_<location-slug> columns → set on-hand at that location (adjustment delta)
      if not p_dry_run and v_id is not null then
        for loc in select id, 'stock_' || lower(replace(name,' ','_')) as key from public.stock_locations where tenant_id = v_tenant loop
          if r ? loc.key and nullif(btrim(coalesce(r->>loc.key,'')),'') is not null then
            v_target := (r->>loc.key)::numeric;
            select coalesce(sum(qty),0) into v_current from public.stock_movements where tenant_id = v_tenant and product_id = v_id and location_id = loc.id;
            if v_target - v_current <> 0 then
              insert into public.stock_movements (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, created_by, note)
              values (v_tenant, v_id, loc.id, v_target - v_current, 0, 'adjustment', null, v_actor, 'import: set on-hand');
              v_stock := v_stock + 1;
            end if;
          end if;
        end loop;
      end if;
    exception when others then
      v_skip := v_skip + 1;
      v_errs := v_errs || jsonb_build_object('sku', v_sku, 'name', v_name, 'error', SQLERRM);
    end;
  end loop;

  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip, 'stock_adjusted', v_stock, 'errors', v_errs);
end $$;
revoke execute on function public.import_products(jsonb, boolean, boolean) from public;
grant  execute on function public.import_products(jsonb, boolean, boolean) to authenticated;

-- PostgREST must see the new signature (Supabase auto-reloads on DDL; this is insurance).
notify pgrst, 'reload schema';


-- Folded in from 202607300000405_stale_till_guard.sql (history repair 2026-09-10): that version stamp collided and the Supabase CLI cannot match 15-digit versions, so the two files ship as one. Applied out-of-band before this repair; already live. Do not split apart.

-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a forgotten till cannot quietly trade on yesterday's day
--
-- What happened (30 Jul 2026): TAB-84A1's service was opened on the 29th and
-- never closed. The next afternoon four real sales rang through it, inherited
-- the session's trading day, and were stamped business_day = 2026-07-29 — so
-- the 30th's Sales Journal showed 3 tickets while the tickets list showed 7,
-- and the missing Rs 26,583.21 sat on the wrong day's books.
--
-- Booking a sale to the till's OPEN trading day is deliberate (audit #2: a sale
-- rung at 1am on a till opened before midnight belongs to that evening, not to
-- the new calendar date). The bug is only the unbounded version of it: a till
-- abandoned since yesterday afternoon is not late-night trading, it is a
-- forgotten close.
--
-- The line between the two is drawn at 06:00 Mauritius time:
--   • before 06:00 — the till's day may lag the calendar date; genuine
--     overnight trading keeps booking to the evening it belongs to;
--   • from 06:00   — a till whose trading day is older than today is stale, and
--     ringing money on it stops with an instruction to close it first.
--
-- Enforced in the shared RPCs so web and Android get it for free:
--   • app.assert_day_open       (called by issue_document — every sale)
--   • create_and_issue_credit_note (refunds stamp business_day the same way)
-- Closing the stale service and opening a fresh one stays allowed — that IS the
-- fix path, and open_cash_session already lands the new service on today.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The check itself ─────────────────────────────────────────────────────────
create or replace function app.assert_till_day_current(p_session uuid) returns void
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare v_date date;
begin
  if p_session is null then return; end if; -- back-office sale: business_day = today, nothing to drift

  select td.business_date into v_date
    from public.cash_sessions cs
    join public.trading_days td on td.id = cs.trading_day_id
   where cs.id = p_session;
  if v_date is null then return; end if; -- unknown session / no day: other guards own that error

  if v_date < app.mu_today()
     and (now() at time zone 'Indian/Mauritius')::time >= time '06:00' then
    raise exception 'this till is still on the day of % — close that service on the till, then open a new one, before taking today''s money', v_date;
  end if;
end $$;

-- ── Every sale: issue_document already funnels through assert_day_open ───────
create or replace function app.assert_day_open(p_tenant uuid, p_session uuid default null::uuid)
returns void
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_closed boolean;
begin
  if p_session is not null then
    select d.status = 'closed' into v_closed
      from public.cash_sessions s join public.trading_days d on d.id = s.trading_day_id
     where s.id = p_session;
    if coalesce(v_closed, false) then
      raise exception 'the day is closed — no more entries or transactions are possible';
    end if;
    -- A still-open day can be the WRONG day: a service forgotten since
    -- yesterday would file today's money under yesterday's journal and Z.
    perform app.assert_till_day_current(p_session);
  end if;
  select status = 'closed' into v_closed from public.trading_days
   where tenant_id = p_tenant and business_date = app.mu_today();
  if coalesce(v_closed, false) then
    raise exception 'the day is closed — no more entries or transactions are possible';
  end if;
end $$;

-- ── Refunds: create_and_issue_credit_note stamps business_day the same way ──
-- Re-issued from the live definition with ONE line added after the session
-- check (a refund on a stale till would drift to yesterday exactly like a
-- sale). Splicing instead of restating so nothing else in the function drifts.
do $$
declare
  r     record;
  v_def text;
begin
  -- Every overload that names a till session must refuse a stale one. Overloads
  -- without a session name no till, so there is no day that could drift — and
  -- later rewrites already carry the guard line: both cases are a no-op here.
  for r in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'create_and_issue_credit_note'
  loop
    select pg_get_functiondef(r.oid) into v_def;
    if position('assert_till_day_current' in v_def) > 0 then continue; end if;
    if position('unknown or closed cash session' in v_def) = 0 then continue; end if;
    v_def := replace(
      v_def,
      ') then raise exception ''unknown or closed cash session''; end if;',
      ') then raise exception ''unknown or closed cash session''; end if;
  perform app.assert_till_day_current(p_session_id);'
    );
    if position('assert_till_day_current' in v_def) = 0 then
      raise exception 'splice anchor not found in create_and_issue_credit_note (%) — guard NOT installed', r.oid::regprocedure;
    end if;
    execute v_def;
  end loop;
end $$;
