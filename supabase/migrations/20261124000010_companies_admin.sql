-- Settings → Companies (tyre centre, phase E): the owner adds and edits the shop's OTHER issuing
-- companies. legal_entities stays read-only to the apps; this is the one way in.
--
--   public.save_legal_entity(p jsonb) → legal_entities   (owner only)
--
-- Rules the database enforces, not just the screen:
--   · the default company is the shop's business profile (Settings → Business profile edits it
--     through app.mirror_profile_to_default_entity); it is not edited here;
--   · once a company has issued anything, its number series (prefixes, padding, next numbers) and
--     its VAT status are fixed — a series never restarts and a bill's VAT treatment never changes
--     under it;
--   · a company not registered for VAT charges 0% and has no VAT number (forced, not trusted);
--   · a company cannot be switched off while products are still sold by it.
-- A one-company shop (Carfectionist) is untouched: nothing here runs unless the owner calls it.

create or replace function public.save_legal_entity(p jsonb)
returns public.legal_entities
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_actor   uuid := app.current_app_user_id();
  v_id      uuid := nullif(p->>'id', '')::uuid;
  v_old     public.legal_entities;
  v_row     public.legal_entities;
  v_issued  boolean := false;
  v_vat     boolean := coalesce((p->>'vat_registered')::boolean, true);
  v_active  boolean := coalesce((p->>'is_active')::boolean, true);
  t         text;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner');

  if nullif(btrim(coalesce(p->>'legal_name', '')), '') is null then
    raise exception 'a company needs its legal name';
  end if;
  foreach t in array array['quote_prefix', 'invoice_prefix', 'credit_note_prefix'] loop
    if nullif(btrim(coalesce(p->>t, '')), '') is null then
      raise exception 'a company needs its % (e.g. WS- for its invoices)', replace(t, '_', ' ');
    end if;
  end loop;

  if v_id is not null then
    select * into v_old from public.legal_entities where id = v_id and tenant_id = v_tenant for update;
    if not found then raise exception 'company not found'; end if;
    if v_old.is_default then
      raise exception 'the main company is edited in Settings → Business profile';
    end if;
    v_issued := exists (select 1 from public.documents d
                         where d.tenant_id = v_tenant and d.legal_entity_id = v_id and d.number is not null);
    if v_issued and (
         v_vat is distinct from v_old.vat_registered
      or (v_vat and coalesce((p->>'vat_rate')::numeric, v_old.vat_rate) is distinct from v_old.vat_rate)
      or btrim(p->>'quote_prefix') is distinct from v_old.quote_prefix
      or btrim(p->>'invoice_prefix') is distinct from v_old.invoice_prefix
      or btrim(p->>'credit_note_prefix') is distinct from v_old.credit_note_prefix
      or coalesce((p->>'quote_number_padding')::int, v_old.quote_number_padding) is distinct from v_old.quote_number_padding
      or coalesce((p->>'invoice_number_padding')::int, v_old.invoice_number_padding) is distinct from v_old.invoice_number_padding
      or coalesce((p->>'credit_note_number_padding')::int, v_old.credit_note_number_padding) is distinct from v_old.credit_note_number_padding
      or coalesce((p->>'quote_next_number')::int, v_old.quote_next_number) is distinct from v_old.quote_next_number
      or coalesce((p->>'invoice_next_number')::int, v_old.invoice_next_number) is distinct from v_old.invoice_next_number
      or coalesce((p->>'credit_note_next_number')::int, v_old.credit_note_next_number) is distinct from v_old.credit_note_next_number) then
      raise exception '% has issued documents — its numbering and VAT status can no longer change', v_old.legal_name;
    end if;
    if not v_active and v_old.is_active
       and exists (select 1 from public.products pr where pr.legal_entity_id = v_id and pr.is_active) then
      raise exception 'products are still sold by % — move them to another company first', v_old.legal_name;
    end if;

    update public.legal_entities set
      legal_name                 = btrim(p->>'legal_name'),
      trading_name               = nullif(btrim(coalesce(p->>'trading_name', '')), ''),
      brn                        = nullif(btrim(coalesce(p->>'brn', '')), ''),
      vat_registered             = v_vat,
      vat_number                 = case when v_vat then nullif(btrim(coalesce(p->>'vat_number', '')), '') end,
      vat_rate                   = case when v_vat then coalesce((p->>'vat_rate')::numeric, vat_rate) else 0 end,
      address                    = nullif(btrim(coalesce(p->>'address', '')), ''),
      phone                      = nullif(btrim(coalesce(p->>'phone', '')), ''),
      email                      = nullif(btrim(coalesce(p->>'email', '')), ''),
      bank_account_name          = nullif(btrim(coalesce(p->>'bank_account_name', '')), ''),
      bank_account_number        = nullif(btrim(coalesce(p->>'bank_account_number', '')), ''),
      bank_name                  = nullif(btrim(coalesce(p->>'bank_name', '')), ''),
      receipt_header_text        = nullif(btrim(coalesce(p->>'receipt_header_text', '')), ''),
      receipt_footer_text        = nullif(btrim(coalesce(p->>'receipt_footer_text', '')), ''),
      quote_prefix               = btrim(p->>'quote_prefix'),
      invoice_prefix             = btrim(p->>'invoice_prefix'),
      credit_note_prefix         = btrim(p->>'credit_note_prefix'),
      quote_number_padding       = coalesce((p->>'quote_number_padding')::int, quote_number_padding),
      invoice_number_padding     = coalesce((p->>'invoice_number_padding')::int, invoice_number_padding),
      credit_note_number_padding = coalesce((p->>'credit_note_number_padding')::int, credit_note_number_padding),
      quote_next_number          = coalesce((p->>'quote_next_number')::int, quote_next_number),
      invoice_next_number        = coalesce((p->>'invoice_next_number')::int, invoice_next_number),
      credit_note_next_number    = coalesce((p->>'credit_note_next_number')::int, credit_note_next_number),
      sort_order                 = coalesce((p->>'sort_order')::int, sort_order),
      is_active                  = v_active
     where id = v_id
     returning * into v_row;

    -- Its products follow a VAT status change (only possible before it has issued anything):
    -- not registered → they sell at 0%; registered again → back to the shop's default rate.
    if v_old.vat_registered and not v_vat then
      update public.products set vat_rate = 0
       where tenant_id = v_tenant and legal_entity_id = v_id and vat_rate is distinct from 0;
    elsif not v_old.vat_registered and v_vat then
      update public.products set vat_rate = null
       where tenant_id = v_tenant and legal_entity_id = v_id and vat_rate = 0;
    end if;
  else
    insert into public.legal_entities (
      tenant_id, legal_name, trading_name, brn, vat_registered, vat_number, vat_rate,
      address, phone, email, bank_account_name, bank_account_number, bank_name,
      receipt_header_text, receipt_footer_text,
      quote_prefix, invoice_prefix, credit_note_prefix,
      quote_number_padding, invoice_number_padding, credit_note_number_padding,
      quote_next_number, invoice_next_number, credit_note_next_number,
      is_default, sort_order, is_active)
    values (
      v_tenant, btrim(p->>'legal_name'), nullif(btrim(coalesce(p->>'trading_name', '')), ''),
      nullif(btrim(coalesce(p->>'brn', '')), ''), v_vat,
      case when v_vat then nullif(btrim(coalesce(p->>'vat_number', '')), '') end,
      case when v_vat then coalesce((p->>'vat_rate')::numeric, 15) else 0 end,
      nullif(btrim(coalesce(p->>'address', '')), ''), nullif(btrim(coalesce(p->>'phone', '')), ''),
      nullif(btrim(coalesce(p->>'email', '')), ''),
      nullif(btrim(coalesce(p->>'bank_account_name', '')), ''), nullif(btrim(coalesce(p->>'bank_account_number', '')), ''),
      nullif(btrim(coalesce(p->>'bank_name', '')), ''),
      nullif(btrim(coalesce(p->>'receipt_header_text', '')), ''), nullif(btrim(coalesce(p->>'receipt_footer_text', '')), ''),
      btrim(p->>'quote_prefix'), btrim(p->>'invoice_prefix'), btrim(p->>'credit_note_prefix'),
      coalesce((p->>'quote_number_padding')::int, 5), coalesce((p->>'invoice_number_padding')::int, 4),
      coalesce((p->>'credit_note_number_padding')::int, 4),
      coalesce((p->>'quote_next_number')::int, 1), coalesce((p->>'invoice_next_number')::int, 1),
      coalesce((p->>'credit_note_next_number')::int, 1),
      false,
      coalesce((p->>'sort_order')::int,
               (select coalesce(max(sort_order), 0) + 1 from public.legal_entities where tenant_id = v_tenant)),
      v_active)
    returning * into v_row;
  end if;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, case when v_id is null then 'company_added' else 'company_updated' end,
          'legal_entity', v_row.id,
          jsonb_build_object('legal_name', v_row.legal_name, 'vat_registered', v_row.vat_registered,
                             'invoice_prefix', v_row.invoice_prefix, 'is_active', v_row.is_active));
  return v_row;
exception
  when unique_violation then
    raise exception 'another company already uses one of those prefixes — each company needs its own';
end $$;

revoke all on function public.save_legal_entity(jsonb) from public;
revoke all on function public.save_legal_entity(jsonb) from anon;
grant execute on function public.save_legal_entity(jsonb) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.save_legal_entity(jsonb)', 'execute') then
    raise exception 'save_legal_entity must not be callable by anon';
  end if;
end $$;


-- ── A product sold by a company that is not VAT-registered carries 0% VAT ──────────────────────
-- The lines already get 0% at the till (app.lines_stamp_entity), but the PRODUCT's own rate drives
-- the shelf price: a gross-quoting shop's form and sheet import divide a typed price by
-- (1 + rate), and the till shows net × (1 + rate). Left at the default 15%, a Rs 1,150 service
-- would be stored as Rs 1,000 and charged Rs 1,000. Forcing the rate here covers the product form,
-- the sheet import and the tablet alike. A product of the main company (legal_entity_id null) or of
-- a VAT-registered one is not touched — Carfectionist never reaches the update.
create or replace function app.products_follow_entity_vat()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.legal_entity_id is not distinct from old.legal_entity_id
     and new.vat_rate is not distinct from old.vat_rate then
    return new;
  end if;
  if new.legal_entity_id is not null
     and exists (select 1 from public.legal_entities le
                  where le.id = new.legal_entity_id and le.tenant_id = new.tenant_id and not le.vat_registered) then
    new.vat_rate := 0;
  elsif tg_op = 'UPDATE' and old.legal_entity_id is not null
     and new.legal_entity_id is distinct from old.legal_entity_id and new.vat_rate = 0
     and exists (select 1 from public.legal_entities le
                  where le.id = old.legal_entity_id and le.tenant_id = old.tenant_id and not le.vat_registered) then
    -- Leaving a non-VAT company for a VAT-registered one: its forced 0% goes, the default returns.
    new.vat_rate := null;
  end if;
  return new;
end $$;
revoke all on function app.products_follow_entity_vat() from public, anon, authenticated;

drop trigger if exists trg_products_entity_vat on public.products;
create trigger trg_products_entity_vat before insert or update on public.products
  for each row execute function app.products_follow_entity_vat();

-- Products already moved to a non-VAT company before this trigger existed.
update public.products pr set vat_rate = 0
  from public.legal_entities le
 where le.id = pr.legal_entity_id and le.tenant_id = pr.tenant_id
   and not le.vat_registered and pr.vat_rate is distinct from 0;


-- ── The product sheet carries "sold_by" (shops with several companies) ─────────────────────────
-- import_products gains one optional column: sold_by = a company's legal name, trading name or
-- invoice prefix. Spliced into the LIVE definition (same signature, nothing else restated), so the
-- VAT guard of 20260730000040 stays exactly as it is. A sheet without the column imports as before.
-- A row sold by a non-VAT company carries 0% — its price is the price, never divided by 1.15; a row
-- moving back to a VAT company is divided again at the default rate.
do $$
declare
  v_def text;
  v_old text;
  procedure_oid regprocedure := 'public.import_products(jsonb, boolean, boolean)'::regprocedure;
  a text; b text;
begin
  select pg_get_functiondef(procedure_oid) into v_def;
  if position('sold_by' in v_def) > 0 then return; end if;   -- already spliced
  v_old := v_def;

  a := 'v_price numeric; v_rate numeric; v_row_rate numeric; v_existing_rate numeric;';
  b := a || E'\n  v_sold text; v_entity uuid; v_entity_vat boolean;';
  if position(a in v_def) = 0 then raise exception 'import_products splice: declare anchor missing'; end if;
  v_def := replace(v_def, a, b);

  a := '      -- The guard: a gross-quoting shop''s sheet carries the SHELF price';
  b := '      -- Sold by: which company sells this row (blank = leave it as it is).
      v_sold := nullif(btrim(coalesce(r->>''sold_by'','''')),'''');
      v_entity := null; v_entity_vat := null;
      if v_sold is not null then
        select le.id, le.vat_registered into v_entity, v_entity_vat
          from public.legal_entities le
         where le.tenant_id = v_tenant and le.is_active
           and (lower(le.legal_name) = lower(v_sold) or lower(coalesce(le.trading_name, '''')) = lower(v_sold)
                or upper(le.invoice_prefix) = upper(v_sold))
         order by le.is_default desc, le.sort_order
         limit 1;
        if v_entity is null then
          raise exception ''sold_by "%" is not one of this shop''''s companies'', v_sold;
        end if;
      end if;

' || a;
  if position(a in v_def) = 0 then raise exception 'import_products splice: guard anchor missing'; end if;
  v_def := replace(v_def, a, b);

  a := '      v_row_rate := nullif(btrim(coalesce(r->>''vat_rate'','''')),'''')::numeric;';
  b := a || E'\n      if v_entity_vat = false then v_row_rate := 0; end if;';
  if position(a in v_def) = 0 then raise exception 'import_products splice: row-rate anchor missing'; end if;
  v_def := replace(v_def, a, b);

  a := '          select vat_rate into v_existing_rate from public.products where id = v_id;';
  b := a || '
          -- Moving from a non-VAT company to a VAT-registered one: its forced 0% is not a real rate.
          if v_entity_vat and v_existing_rate = 0 and exists (
               select 1 from public.products pr join public.legal_entities le on le.id = pr.legal_entity_id
                where pr.id = v_id and not le.vat_registered) then
            v_existing_rate := null;
          end if;';
  if position(a in v_def) = 0 then raise exception 'import_products splice: existing-rate anchor missing'; end if;
  v_def := replace(v_def, a, b);

  a := '            is_active           = case when r ? ''is_active'' then app.csv_bool(r->>''is_active'') else is_active end
          where id = v_id;';
  b := '            is_active           = case when r ? ''is_active'' then app.csv_bool(r->>''is_active'') else is_active end,
            legal_entity_id     = coalesce(v_entity, legal_entity_id)
          where id = v_id;';
  if position(a in v_def) = 0 then raise exception 'import_products splice: update anchor missing'; end if;
  v_def := replace(v_def, a, b);

  a := 'vat_rate, is_stocked, low_stock_threshold, is_active)';
  b := 'vat_rate, is_stocked, low_stock_threshold, is_active, legal_entity_id)';
  if position(a in v_def) = 0 then raise exception 'import_products splice: insert-columns anchor missing'; end if;
  v_def := replace(v_def, a, b);

  a := '            case when r ? ''is_active'' then app.csv_bool(r->>''is_active'') else true end)';
  b := '            case when r ? ''is_active'' then app.csv_bool(r->>''is_active'') else true end,
            v_entity)';
  if position(a in v_def) = 0 then raise exception 'import_products splice: insert-values anchor missing'; end if;
  v_def := replace(v_def, a, b);

  execute v_def;
end $$;

-- The public schema's default grants had handed anon EXECUTE (it refused them — no tenant — but
-- the door should not be there). Revoked by name; the web and the tablet call it signed in.
revoke all on function public.import_products(jsonb, boolean, boolean) from public, anon;
grant execute on function public.import_products(jsonb, boolean, boolean) to authenticated;

do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'import_products') <> 1 then
    raise exception 'import_products must have exactly one overload';
  end if;
  if has_function_privilege('anon', 'public.import_products(jsonb, boolean, boolean)', 'execute') then
    raise exception 'import_products must not be callable by anon';
  end if;
end $$;
