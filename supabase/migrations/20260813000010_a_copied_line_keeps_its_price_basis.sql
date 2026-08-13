-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a copied line keeps its price basis.
--
-- 20260812000020 taught document_lines that a unit_price can BE the VAT-inclusive
-- figure (price_includes_vat), and save_draft carries the flag. But the four RPCs
-- that create a document BY COPYING another one's lines still name every column
-- EXCEPT the flag, so the copy silently reverts to "net + add VAT":
--
--   convert_quote_to_invoice     billing the accepted TESTQ-00033 (SILVER 4X4/VAN,
--                                typed 1,759.99 incl) produced a 2,023.99 invoice —
--                                the agreed price re-VAT'd a second time.
--   create_and_issue_credit_note the refund of such an invoice would mis-state the
--                                same way — a fiscal document, so worse.
--   duplicate_document           a copy of a quote re-prices its flagged lines.
--   revise_quote                 a revision re-prices the lines the customer signed.
--
-- Each is spliced in place from its LIVE definition (pg_get_functiondef), adding
-- price_includes_vat to the column list and the select list — the same technique
-- 20260812000020 used on save_draft, so whatever else those functions do stays
-- byte-identical. Same identity signature ⇒ create or replace hits the same
-- overload (no stale twins). Idempotent: once patched, the anchors no longer
-- match and the executed definition is unchanged.
--
-- Deliberately NOT touched: create_intake_quote and create_document_from_job
-- insert a zero-priced placeholder line (unit_price = 0) — 0 net and 0 gross are
-- the same figure, so the default false is already correct there.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_fn regprocedure;
  v_src text;
  v_hits int;
begin
  foreach v_fn in array array[
    'public.convert_quote_to_invoice(uuid)'::regprocedure,
    'public.create_and_issue_credit_note(uuid, uuid, boolean, uuid)'::regprocedure,
    'public.duplicate_document(uuid)'::regprocedure,
    'public.revise_quote(uuid)'::regprocedure
  ] loop
    v_src := pg_get_functiondef(v_fn);

    -- Column list (the paren distinguishes it from the select list) — both shapes.
    v_src := replace(v_src,
      'discount_amount, vat_rate, sort_order)',
      'discount_amount, vat_rate, sort_order, price_includes_vat)');
    v_src := replace(v_src,
      'vat_rate, sort_order, line_kind)',
      'vat_rate, sort_order, line_kind, price_includes_vat)');

    -- Select list (runs straight into "from public.document_lines") — both shapes.
    v_src := replace(v_src,
      'discount_amount, vat_rate, sort_order' || e'\n  from public.document_lines',
      'discount_amount, vat_rate, sort_order, price_includes_vat' || e'\n  from public.document_lines');
    v_src := replace(v_src,
      'vat_rate, sort_order, line_kind' || e'\n  from public.document_lines',
      'vat_rate, sort_order, line_kind, price_includes_vat' || e'\n  from public.document_lines');

    -- The copy insert must now carry the flag in BOTH lists, or refuse to ship.
    v_hits := (length(v_src) - length(replace(v_src, 'price_includes_vat', ''))) / length('price_includes_vat');
    if v_hits < 2 then
      raise exception 'splice failed for % — price_includes_vat appears % time(s), want 2', v_fn, v_hits;
    end if;

    execute v_src;
  end loop;
end $$;

-- Belt and braces: re-read the deployed definitions and refuse to commit if any
-- copy path still drops the flag.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('convert_quote_to_invoice','create_and_issue_credit_note','duplicate_document','revise_quote')
  loop
    if pg_get_functiondef(r.fn::oid) not like '%price_includes_vat%' then
      raise exception '% still drops price_includes_vat on copy', r.fn;
    end if;
  end loop;
end $$;
