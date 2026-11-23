-- A product sheet that sets a count turns stock tracking on.
--
-- import_products wrote stock_<location> columns as 'import: set on-hand' movements even for a
-- product with is_stocked = false. Every stock screen (web Inventory picker, tablet Stock) lists
-- only stocked products, so the count was on the ledger yet the product could not be found to
-- adjust or sell from — the tyre sandbox's four seeded tyres (seeded untracked) hit exactly that.
--
-- Now a non-blank stock column on a product row flips is_stocked on (never for a service — the
-- products_check constraint forbids it). Spliced into the LIVE definition, as 20261124000010 did,
-- so the VAT guard and sold_by stay exactly as they are.
do $$
declare
  v_def text;
  procedure_oid regprocedure := 'public.import_products(jsonb, boolean, boolean)'::regprocedure;
  a text; b text;
begin
  select pg_get_functiondef(procedure_oid) into v_def;
  if position('-- A sheet that sets a count tracks the product.' in v_def) > 0 then return; end if;

  a := '            v_target := (r->>loc.key)::numeric;';
  b := '            -- A sheet that sets a count tracks the product.
            update public.products set is_stocked = true
             where id = v_id and kind <> ''service'' and not is_stocked;
' || a;
  if position(a in v_def) = 0 then raise exception 'import_products splice: stock anchor missing'; end if;
  v_def := replace(v_def, a, b);

  execute v_def;
end $$;

-- Products already counted by an import but left untracked (at writing: only the tyre sandbox's).
update public.products p set is_stocked = true
 where not p.is_stocked and p.kind <> 'service'
   and exists (select 1 from public.stock_movements m
                where m.product_id = p.id and m.note = 'import: set on-hand');
