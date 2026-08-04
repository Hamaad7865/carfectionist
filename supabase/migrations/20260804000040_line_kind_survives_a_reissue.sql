-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — put line_kind back into save_draft.
--
-- 20260804000020_a_line_knows_if_it_is_work.sql spliced line_kind into
-- save_draft so a hand-typed line could say whether it is WORK or GOODS. The
-- rich-content work (#5) then reissued save_draft to carry description_richtext
-- and unit_label — from a definition captured before that splice existed. No
-- error, no warning: the column simply stopped being written.
--
-- What that cost, live, for as long as it stood: both ad-hoc dialogs went on
-- asking "Service or Product", both clients went on sending the answer, and
-- save_draft dropped it on the floor. Every hand-typed line came back NULL, so
-- the effective kind fell through to its history fallback of 'service' and a
-- goods-only quote was read as work again — the exact thing the feature exists
-- to prevent. Caught by scripts/_verify-line-kind.mjs, which is why it is a
-- probe and not a unit test: nothing in the app can see this happen.
--
-- Spliced from the LIVE definition, never retyped, so whatever else has landed
-- on save_draft since is carried forward untouched. That cuts both ways —
-- reissuing any of these copy functions from an older file silently drops
-- whatever the newer ones added. Read the installed body first.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_draft';
  if v_def is null then raise exception 'public.save_draft not found'; end if;

  -- Already carries the guarded form: nothing to do.
  if position('catalogue lines defer' in v_def) > 0 then return; end if;

  if position('discount_pct, discount_kind, discount_amount, vat_rate, sort_order)' in v_def) = 0 then
    raise exception 'save_draft: column-list anchor not found — line_kind NOT restored';
  end if;
  v_def := replace(
    v_def,
    'discount_pct, discount_kind, discount_amount, vat_rate, sort_order)',
    'discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind)'
  );

  if position('coalesce((l->>''sort_order'')::int, (ord - 1)::int)' in v_def) = 0 then
    raise exception 'save_draft: select-list anchor not found — line_kind NOT restored';
  end if;
  -- A CATALOGUE line's kind is not the client's to state: products.kind answers, and a
  -- second copy here is how the two come to disagree. The trailing comment is the marker
  -- that says the guarded form is installed; it survives pg_get_functiondef.
  v_def := replace(
    v_def,
    'coalesce((l->>''sort_order'')::int, (ord - 1)::int)',
    'coalesce((l->>''sort_order'')::int, (ord - 1)::int),
    case when nullif(l->>''product_id'','''') is null
          then nullif(l->>''line_kind'','''')::product_kind end /* catalogue lines defer to products.kind */'
  );
  execute v_def;
end $$;

-- ── prove it against what is actually installed ─────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_draft';
  if position('catalogue lines defer' in v_def) = 0 then
    raise exception 'save_draft still does not store line_kind';
  end if;
  -- The reason this migration exists: do not let the repair drop what the
  -- rich-content work added.
  if position('description_richtext' in v_def) = 0 then
    raise exception 'save_draft lost description_richtext — the splice was built on a stale body';
  end if;
end $$;
