-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a typed-in line says whether it is work or goods.
--
-- The shop's flow: a quote is sent, the customer signs it, and what happens next
-- depends on what is ON it. Work on a car becomes a JOB on the board. Goods over
-- the counter are a SALE — there is nothing to track through the bays.
--
-- The app cannot tell the two apart today. A catalogue line answers through
-- products.kind ('service' | 'product' | 'consumable'), but an AD-HOC line — the
-- one someone types because it is not in the catalogue — carries product_id NULL
-- and nothing else. There is no column that could hold the answer, so the accept
-- panel has always had to guess, and it guessed "start the work now" every time.
--
-- So: document_lines.line_kind. Set explicitly on a typed-in line (both surfaces
-- now ask, always); left NULL on a catalogue line, where products.kind is the
-- better answer and duplicating it would only let the two drift.
--
-- The effective kind of a line is therefore:
--     coalesce(line_kind, products.kind, 'service')
--
-- The 'service' at the end is for HISTORY only. Every ad-hoc line written before
-- today has no stated kind, and ad-hoc lines have overwhelmingly been typed
-- labour — create_intake_quote and create_document_from_job both raise theirs as
-- the literal words "Service work". Reading those as goods would put the shop's
-- back catalogue of quotes on the wrong side of the decision. From today nothing
-- new relies on it: the dialogs ask.
--
-- NOT TOUCHED: convert_quote_to_invoice and create_and_issue_credit_note. Both
-- copy lines onto an INVOICE or a credit note, where nothing reads the kind —
-- the job-or-sale question is asked of a quote, once, as it is accepted. Leaving
-- them alone also keeps this clear of the billing change landing beside it.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.document_lines
  add column if not exists line_kind product_kind;

comment on column public.document_lines.line_kind is
  'Stated kind of a typed-in (ad-hoc) line. NULL on a catalogue line — products.kind answers for those. Effective kind: coalesce(line_kind, products.kind, ''service'').';

-- ── the writer: save_draft carries what the dialogs stated ───────────────────
-- Spliced from the live definition rather than restated: this function is long,
-- it has been edited by four migrations, and retyping it is how a body silently
-- reverts (see 20260802000010).
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_draft';
  if v_def is null then raise exception 'public.save_draft not found'; end if;

  -- A CATALOGUE line's kind is not the client's to state: products.kind answers, and
  -- storing a second copy here is how the two come to disagree. The RPC drops it rather
  -- than trusting every client to remember — the trailing comment is the marker that
  -- says this guarded form is installed, and it survives pg_get_functiondef.
  if position('catalogue lines defer' in v_def) = 0 then
    if position('line_kind' in v_def) > 0 then
      -- An earlier run spliced the ungarded form; upgrade it in place.
      v_def := replace(
        v_def,
        'nullif(l->>''line_kind'','''')::product_kind',
        'case when nullif(l->>''product_id'','''') is null
          then nullif(l->>''line_kind'','''')::product_kind end /* catalogue lines defer to products.kind */'
      );
    else
      if position('discount_pct, discount_kind, discount_amount, vat_rate, sort_order)' in v_def) = 0 then
        raise exception 'save_draft: column-list anchor not found — line_kind NOT installed';
      end if;
      v_def := replace(
        v_def,
        'discount_pct, discount_kind, discount_amount, vat_rate, sort_order)',
        'discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind)'
      );

      if position('coalesce((l->>''sort_order'')::int, (ord - 1)::int)' in v_def) = 0 then
        raise exception 'save_draft: select-list anchor not found — line_kind NOT installed';
      end if;
      v_def := replace(
        v_def,
        'coalesce((l->>''sort_order'')::int, (ord - 1)::int)',
        'coalesce((l->>''sort_order'')::int, (ord - 1)::int),
    case when nullif(l->>''product_id'','''') is null
          then nullif(l->>''line_kind'','''')::product_kind end /* catalogue lines defer to products.kind */'
      );
    end if;
    execute v_def;
  end if;
end $$;

-- ── the copiers: a revision and a duplicate keep what was stated ─────────────
-- A revision IS the quote being renegotiated, and a duplicate is that quote
-- again. Dropping the kinds on the way through would make the accept panel
-- guess again on exactly the documents most likely to be accepted.
do $$
declare
  v_def text;
  v_fn  text;
begin
  foreach v_fn in array array['revise_quote', 'duplicate_document'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_def is null then raise exception 'public.% not found', v_fn; end if;
    continue when position('line_kind' in v_def) > 0;

    if position('vat_rate, sort_order)' in v_def) = 0
       or position('vat_rate, sort_order
  from public.document_lines' in v_def) = 0 then
      raise exception '%: line-copy anchors not found — line_kind NOT carried', v_fn;
    end if;

    -- The select first: its anchor is a prefix of nothing else, and doing the
    -- column list first would make the two indistinguishable.
    v_def := replace(
      v_def,
      'vat_rate, sort_order
  from public.document_lines',
      'vat_rate, sort_order, line_kind
  from public.document_lines'
    );
    v_def := replace(v_def, 'vat_rate, sort_order)', 'vat_rate, sort_order, line_kind)');
    execute v_def;
  end loop;
end $$;

-- ── the two placeholder lines the app writes itself ──────────────────────────
-- Both say "Service work" in so many words. Saying it in the data too is what
-- lets reception's intake quote and a job's bill default to a job without
-- anybody ticking anything.
do $$
declare
  v_def text;
  v_fn  text;
begin
  foreach v_fn in array array['create_intake_quote', 'create_document_from_job'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_def is null then raise exception 'public.% not found', v_fn; end if;
    continue when position('line_kind' in v_def) > 0;

    if position('discount_pct, vat_rate, sort_order)' in v_def) = 0
       or position('coalesce(v_bs.vat_rate, 15), 0);' in v_def) = 0 then
      raise exception '%: placeholder-line anchors not found — line_kind NOT set', v_fn;
    end if;
    v_def := replace(v_def, 'discount_pct, vat_rate, sort_order)', 'discount_pct, vat_rate, sort_order, line_kind)');
    v_def := replace(v_def, 'coalesce(v_bs.vat_rate, 15), 0);', 'coalesce(v_bs.vat_rate, 15), 0, ''service'');');
    execute v_def;
  end loop;
end $$;

-- ── prove it against what is actually installed ─────────────────────────────
do $$
declare v_missing text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('save_draft', 'revise_quote', 'duplicate_document', 'create_intake_quote', 'create_document_from_job')
     and position('line_kind' in pg_get_functiondef(p.oid)) = 0;
  if v_missing is not null then
    raise exception 'line_kind did not reach: %', v_missing;
  end if;

  if (select position('catalogue lines defer' in pg_get_functiondef(p.oid)) = 0
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'save_draft') then
    raise exception 'save_draft still trusts a catalogue line''s stated kind';
  end if;
end $$;
