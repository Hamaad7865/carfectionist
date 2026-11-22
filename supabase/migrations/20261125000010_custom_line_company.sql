-- ═══════════════════════════════════════════════════════════════════════════
-- Tyre centre — a custom line says which company sells it
--
-- The tablet's till (docs/redesign/DESIGN-SPEC.md §6.4) ends its catalogue with a
-- "Custom line · Pick the company" tile: a hand-typed line on a shop with two
-- companies must say whether the tyre company or the service company sells it.
-- Until now save_draft never wrote a line's legal_entity_id, so
-- app.lines_stamp_entity filed every ad-hoc line under the document's (or the
-- main) company — a hand-typed alignment landed on the VAT tyre invoice.
--
-- WHAT CHANGES (save_draft only)
--   • A line with NO product may carry "legal_entity_id": kept when it names an
--     ACTIVE company of the caller's own shop, ignored otherwise (null → the
--     stamp trigger decides exactly as before). A catalogue line never takes
--     it: its company is its product's, always.
--   • lines_stamp_entity keeps a line's own company (unchanged), and still
--     zeroes the VAT of a non-VAT company's line.
--
-- WHAT DOES NOT CHANGE
--   Everything else in save_draft. The body is today's live definition with
--   one column added — read back from the catalog and edited in place, so no
--   fence added since 20260910000130 can be lost by retyping it. A one-company
--   shop (Carfectionist) sends no legal_entity_id and sees no difference.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_def text;
  v_new text;
  v_cols_old constant text := 'sort_order, line_kind, price_includes_vat)';
  v_cols_new constant text := 'sort_order, line_kind, price_includes_vat, legal_entity_id)';
  v_val_old constant text := 'coalesce((l->>''price_includes_vat'')::boolean, false) /* catalogue lines defer to products.kind */';
  v_val_new constant text := 'coalesce((l->>''price_includes_vat'')::boolean, false) /* catalogue lines defer to products.kind */,
    /* a custom line names its company (an active one of this shop); a catalogue line never does */
    case when nullif(l->>''product_id'','''') is null then
      (select e.id from public.legal_entities e
        where e.id = nullif(l->>''legal_entity_id'','''')::uuid and e.tenant_id = v_tenant and e.is_active)
    end';
begin
  v_def := pg_get_functiondef('public.save_draft(jsonb,jsonb,integer)'::regprocedure);
  if position('a custom line names its company' in v_def) > 0 then
    raise notice 'save_draft already keeps a custom line''s company';
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_cols_old, ''))) / length(v_cols_old) <> 1
     or (length(v_def) - length(replace(v_def, v_val_old, ''))) / length(v_val_old) <> 1 then
    raise exception 'save_draft is not the shape this migration edits — write it out by hand';
  end if;
  v_new := replace(replace(v_def, v_cols_old, v_cols_new), v_val_old, v_val_new);
  execute v_new;
end $$;

-- ─── prove it: the column is written, and every earlier fence still stands ───
do $$
declare
  v_save text;
  v_overloads int;
begin
  select count(*) into v_overloads from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_draft';
  if v_overloads <> 1 then
    raise exception 'save_draft has % overloads — expected exactly one', v_overloads;
  end if;
  select pg_get_functiondef('public.save_draft(jsonb,jsonb,integer)'::regprocedure) into v_save;
  if position('a custom line names its company' in v_save) = 0 then
    raise exception 'save_draft does not keep a custom line''s company';
  end if;
  if position('was_total' in v_save) = 0
     or position('assert_no_live_bill' in v_save) = 0
     or position('assert_discount_allowed' in v_save) = 0
     or position('cannot change the customer on an issued quote' in v_save) = 0
     or position('a line names a car that is not this customer' in v_save) = 0
     or position('app.document_cars' in v_save) = 0 then
    raise exception 'save_draft lost a fence while gaining the custom-line company';
  end if;
  raise notice 'a custom line keeps its company; every fence still stands';
end $$;
