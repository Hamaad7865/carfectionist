-- ═══════════════════════════════════════════════════════════════════════════
-- "Final cash float" is the whole drawer counted at close, not the standing float.
--
-- The owner reads "Final cash float" as: the initial float PLUS the cash that ended
-- up in the drawer — i.e. everything physically counted at close. On a normal day
-- that is opening 2,000 + the day's cash takings = the counted figure.
--
--     Initial cash float   2,000.00
--     Final cash float     3,100.00   ← the whole drawer counted at close
--     Counted              3,100.00
--
-- 20260905000010 had frozen float_final as the cash row's float_out — which, since
-- the same migration made the standing float stay in the drawer (remit = takings,
-- float_out = opening), always came out at the opening float (2,000). The owner has
-- now scoped that line the other way: it must show the counted drawer.
--
-- ONLY the DISPLAY figure moves. float_out in cash_session_methods, the remittance
-- to the bank, and the float carried forward to tomorrow are the 20260905000010
-- logic untouched — this migration must not bank a cent differently. float_final is
-- decoupled from float_out and reads v_sess.closing_count (top-level) / s3.closing_count
-- (each service block) — the very columns 'counted_cash' already reads, so Final == Counted
-- by design. Nothing recomputes an already-cut Z; past slips keep their frozen figures.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'close_service';
  if v_def is null then raise exception 'public.close_service not found'; end if;

  -- Already the whole-drawer version? (both float_final subselects gone.) Idempotent no-op.
  if v_def !~ 'float_final''\s*,\s*\(select float_out' and v_def !~ 'float_final''\s*,\s*\(select csm\.float_out' then
    return;
  end if;

  -- Guard: the banking logic 20260905000010 installed must be present, or we are
  -- patching the wrong body and could quietly resurrect the swept-to-bank float.
  if position('greatest(p_counted_cash - v_sess.opening_float, 0)' in v_def) = 0 then
    raise exception 'close_service: the standing-float remittance line is missing — refusing to patch a body that would bank the float';
  end if;

  -- Top-level float_final: the closed service's own counted drawer.
  v_def := regexp_replace(
    v_def,
    'float_final''\s*,\s*\(select float_out from public\.cash_session_methods\s+where cash_session_id = p_session_id and method = ''cash''\)',
    'float_final'', v_sess.closing_count',
    'g'
  );

  -- Each service block in services[]: that session's own counted drawer.
  v_def := regexp_replace(
    v_def,
    'float_final''\s*,\s*\(select csm\.float_out from public\.cash_session_methods csm\s+where csm\.cash_session_id = s3\.id and csm\.method = ''cash''\)',
    'float_final'',   s3.closing_count',
    'g'
  );

  execute v_def;
end $$;

-- ── prove the shape ──────────────────────────────────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'close_service';

  -- No float_final may still be read from a float_out subselect.
  if v_def ~ 'float_final''\s*,\s*\(select float_out' or v_def ~ 'float_final''\s*,\s*\(select csm\.float_out' then
    raise exception 'close_service still freezes float_final from float_out — the Final float would keep reading the standing float';
  end if;
  -- Both float_final keys survive, now fed by the counted columns.
  if position('''float_final'', v_sess.closing_count' in v_def) = 0 then
    raise exception 'close_service lost the top-level float_final';
  end if;
  if position('''float_final'',   s3.closing_count' in v_def) = 0 then
    raise exception 'close_service lost the per-service float_final';
  end if;
  -- Banking is still the standing-float logic, and float_out still carries forward.
  if position('greatest(p_counted_cash - v_sess.opening_float, 0)' in v_def) = 0 then
    raise exception 'close_service: the standing-float remittance logic was altered';
  end if;
end $$;
