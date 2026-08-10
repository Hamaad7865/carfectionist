-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — issuing is where the discount rule bites.
--
-- save_draft deliberately still accepts an over-limit discount. A cashier must
-- be able to save the bill and THEN go and find the owner; refusing at save
-- would mean losing the basket to ask permission.
--
-- issue_document is the fiscal gate every path funnels through — web, tablet,
-- and an offline sale replaying hours later — so it is the one place the rule
-- cannot be walked around.
--
-- Placed AFTER the no-lines check and BEFORE numbering: the document is locked
-- and validated by then, and nothing has been consumed that a refusal would have
-- to unwind. It also sits after the idempotency replay branch, which is
-- load-bearing — a retry of an already-issued sale must answer from the ledger
-- rather than be re-judged (see 20260802000010).
--
-- Spliced, not retyped. This function is ~145 lines and has been rebuilt by six
-- migrations; retyping it from an older text is how the replay fix was silently
-- reverted once already, and how a stray db push reverted six other functions
-- on 2026-08-10 (see 20260810000015).
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'issue_document';
  if v_def is null then raise exception 'public.issue_document not found'; end if;
  if position('assert_discount_allowed' in v_def) > 0 then return; end if;

  -- Refuse to splice a function that has lost earlier work; blessing a reverted
  -- body as current is what let the last regression hide.
  if position('ORDER IS LOAD-BEARING' in v_def) = 0 then
    raise exception 'issue_document has lost its replay-ordering fix — repair it before splicing onto it';
  end if;

  if position('if v_lines = 0 then raise exception ''cannot issue a document with no lines''; end if;' in v_def) = 0 then
    raise exception 'issue_document: no-lines anchor not found — the discount guard was NOT installed';
  end if;

  v_def := replace(
    v_def,
    'if v_lines = 0 then raise exception ''cannot issue a document with no lines''; end if;',
    'if v_lines = 0 then raise exception ''cannot issue a document with no lines''; end if;

  -- No discount on a service; a carwash to 5% with a reason; anything beyond
  -- needs an owner override naming this document. See 20260810000040.
  perform app.assert_discount_allowed(v_doc.id);'
  );

  execute v_def;
end $$;

-- ── prove it against what is actually installed ─────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'issue_document';

  if position('assert_discount_allowed' in v_def) = 0 then
    raise exception 'issue_document never learned the discount guard';
  end if;
  -- The splice must not have cost the function anything it already had.
  if position('ORDER IS LOAD-BEARING' in v_def) = 0 then
    raise exception 'issue_document lost its replay-ordering fix while learning the guard';
  end if;
  if position('assert_day_open' in v_def) = 0 then
    raise exception 'issue_document lost its closed-day guard while learning the discount guard';
  end if;
  -- The guard must sit AFTER the replay branch, not before it.
  if position('assert_discount_allowed' in v_def) < position('idempotency_keys' in v_def) then
    raise exception 'the discount guard was spliced ahead of the replay branch';
  end if;
end $$;
