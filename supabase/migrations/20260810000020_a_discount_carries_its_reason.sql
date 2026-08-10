-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a discount says why it was given.
--
-- Rule 2 of 2026-08-10: a carwash may be discounted 5%, and only if a reason is
-- given. One box per document, not one per line — a cashier types one sentence,
-- and per-line reasons would be theatre. It is read back in Activity.
--
-- Nothing enforces it yet. The arithmetic that decides when a reason is OWED
-- lands in 20260810000040, and the refusal in 20260810000050; this migration
-- only makes somewhere for the answer to live and teaches the write path to
-- carry it.
--
-- save_draft is spliced rather than retyped: it is long, six migrations have
-- edited it, and retyping a body from an older migration is how a live fix
-- silently reverts (see 20260802000010 — and 20260810000015, where a stray
-- `db push` did exactly that to this function).
--
-- The column-list anchor below is `discount_kind, discount_value, comment,
-- created_by)`, WITH the comment column. An earlier draft of this migration
-- anchored on `discount_kind, discount_value, created_by)` and matched — but
-- only because save_draft had at that moment been reverted to its 8 July body,
-- which predates document comments. It would have stopped matching the instant
-- the function was repaired. The anchor now names what the current function
-- actually says.
--
-- discount_reason is inserted directly after discount_value in BOTH the column
-- list and the values list, so the two stay positionally aligned. Appending it
-- to one list and not the other in the same place is how a splice writes a
-- comment into a reason column.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.documents
  add column if not exists discount_reason text;

comment on column public.documents.discount_reason is
  'Why a discount reaching into a service or carwash allowance was given. Required by app.assert_discount_allowed when the discount passes what the goods lines alone would cover.';

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_draft';
  if v_def is null then raise exception 'public.save_draft not found'; end if;
  if position('discount_reason' in v_def) > 0 then return; end if;

  -- Refuse to splice a save_draft that has lost its earlier work. Doing so would
  -- quietly bless a reverted function as current, which is what let the last
  -- regression hide.
  if position('line_kind' in v_def) = 0 then
    raise exception 'save_draft has lost line_kind — repair it (20260810000015) before splicing onto it';
  end if;

  -- ── the UPDATE branch ─────────────────────────────────────────────────────
  if position('discount_value     = case when p_doc ? ''discount_value''' in v_def) = 0 then
    raise exception 'save_draft: UPDATE anchor not found — discount_reason NOT installed';
  end if;
  v_def := replace(
    v_def,
    'discount_value     = case when p_doc ? ''discount_value''',
    'discount_reason    = case when p_doc ? ''discount_reason'' then nullif(p_doc->>''discount_reason'','''') else discount_reason end,
      discount_value     = case when p_doc ? ''discount_value'''
  );

  -- ── the INSERT branch: column list and values list, same position ─────────
  if position('discount_kind, discount_value, comment, created_by)' in v_def) = 0 then
    raise exception 'save_draft: INSERT column anchor not found — discount_reason NOT installed';
  end if;
  if position('coalesce((p_doc->>''discount_value'')::numeric,0),' in v_def) = 0 then
    raise exception 'save_draft: INSERT values anchor not found — discount_reason NOT installed';
  end if;

  v_def := replace(v_def,
    'discount_kind, discount_value, comment, created_by)',
    'discount_kind, discount_value, discount_reason, comment, created_by)');
  v_def := replace(v_def,
    'coalesce((p_doc->>''discount_value'')::numeric,0),',
    'coalesce((p_doc->>''discount_value'')::numeric,0), nullif(p_doc->>''discount_reason'',''''),');

  execute v_def;
end $$;

-- ── prove it against what is actually installed ─────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_draft';

  if position('discount_reason' in v_def) = 0 then
    raise exception 'save_draft never learned discount_reason';
  end if;
  -- The splice must not have cost the function anything it already had.
  if position('line_kind' in v_def) = 0 then
    raise exception 'save_draft lost line_kind while learning discount_reason';
  end if;
  if position('catalogue lines defer' in v_def) = 0 then
    raise exception 'save_draft lost its catalogue-line guard while learning discount_reason';
  end if;
end $$;
