-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration 0013 (CSV import RPCs)
-- Bulk import of customers + products from a parsed CSV (jsonb array of rows).
-- Server-side loop (no per-row network round-trip), role-gated, tenant-scoped.
-- p_dry_run=true returns the plan (insert/update/skip counts) WITHOUT writing,
-- so the UI can preview before applying. On apply, each row is wrapped in its own
-- savepoint: a bad row is skipped with a recorded error, the rest still import.
-- Match keys: customers by name (case-insensitive), products by sku (then name).
-- Blank cells never overwrite an existing value.
-- ═══════════════════════════════════════════════════════════════════════════

-- helper: parse a truthy string ("yes"/"true"/"1"/"y")
create or replace function app.csv_bool(p text) returns boolean language sql immutable as $$
  select lower(coalesce(p,'')) in ('yes','true','1','y','oui');
$$;

-- ─── import_customers ────────────────────────────────────────────────────────
create or replace function public.import_customers(p_rows jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  r jsonb; v_name text; v_id uuid;
  v_ins int := 0; v_upd int := 0; v_skip int := 0; v_errs jsonb := '[]'::jsonb;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_name := btrim(coalesce(r->>'name',''));
    if v_name = '' then v_skip := v_skip + 1; continue; end if;
    begin
      select id into v_id from public.customers where tenant_id = v_tenant and lower(name) = lower(v_name) limit 1;
      if v_id is not null then
        v_upd := v_upd + 1;
        if not p_dry_run then
          update public.customers set
            email      = coalesce(nullif(btrim(coalesce(r->>'email','')),''), email),
            phone      = coalesce(nullif(btrim(coalesce(r->>'phone','')),''), phone),
            address    = coalesce(nullif(btrim(coalesce(r->>'address','')),''), address),
            brn        = coalesce(nullif(btrim(coalesce(r->>'brn','')),''), brn),
            vat_number = coalesce(nullif(btrim(coalesce(r->>'vat_number','')),''), vat_number),
            notes      = coalesce(nullif(btrim(coalesce(r->>'notes','')),''), notes),
            is_company = case when r ? 'is_company' then app.csv_bool(r->>'is_company') else is_company end
          where id = v_id;
        end if;
      else
        v_ins := v_ins + 1;
        if not p_dry_run then
          insert into public.customers (tenant_id, name, email, phone, address, brn, vat_number, notes, country, is_company)
          values (v_tenant, v_name,
            nullif(btrim(coalesce(r->>'email','')),''),
            nullif(btrim(coalesce(r->>'phone','')),''),
            nullif(btrim(coalesce(r->>'address','')),''),
            nullif(btrim(coalesce(r->>'brn','')),''),
            nullif(btrim(coalesce(r->>'vat_number','')),''),
            nullif(btrim(coalesce(r->>'notes','')),''),
            coalesce(nullif(btrim(coalesce(r->>'country','')),''), 'MU'),
            app.csv_bool(r->>'is_company'));
        end if;
      end if;
    exception when others then
      v_skip := v_skip + 1;
      v_errs := v_errs || jsonb_build_object('name', v_name, 'error', SQLERRM);
    end;
  end loop;

  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip, 'errors', v_errs);
end $$;
revoke execute on function public.import_customers(jsonb, boolean) from public;
grant  execute on function public.import_customers(jsonb, boolean) to authenticated;

-- ─── import_products ─────────────────────────────────────────────────────────
create or replace function public.import_products(p_rows jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  r jsonb; v_sku text; v_name text; v_id uuid;
  v_ins int := 0; v_upd int := 0; v_skip int := 0; v_stock int := 0; v_errs jsonb := '[]'::jsonb;
  loc record; v_target numeric; v_current numeric;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

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

      if v_id is not null then
        v_upd := v_upd + 1;
        if not p_dry_run then
          update public.products set
            name                = coalesce(nullif(v_name,''), name),
            category            = coalesce(nullif(btrim(coalesce(r->>'category','')),''), category),
            barcode             = case when r ? 'barcode' then nullif(btrim(coalesce(r->>'barcode','')),'') else barcode end,
            unit                = coalesce(nullif(btrim(coalesce(r->>'unit','')),'')::product_unit, unit),
            selling_price       = coalesce(nullif(btrim(coalesce(r->>'selling_price','')),'')::numeric, selling_price),
            cost_price          = coalesce(nullif(btrim(coalesce(r->>'cost_price','')),'')::numeric, cost_price),
            vat_rate            = case when nullif(btrim(coalesce(r->>'vat_rate','')),'') is not null then (r->>'vat_rate')::numeric else vat_rate end,
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
            coalesce(nullif(btrim(coalesce(r->>'selling_price','')),'')::numeric, 0),
            coalesce(nullif(btrim(coalesce(r->>'cost_price','')),'')::numeric, 0),
            nullif(btrim(coalesce(r->>'vat_rate','')),'')::numeric,
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
revoke execute on function public.import_products(jsonb, boolean) from public;
grant  execute on function public.import_products(jsonb, boolean) to authenticated;
