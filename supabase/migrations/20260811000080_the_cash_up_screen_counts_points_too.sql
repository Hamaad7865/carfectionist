-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — the cash-up screen and the Z-report must list the same tenders.
--
-- public.pre_close_summary — the screen a cashier reads BEFORE counting the
-- drawer — built its rows from a literal:
--
--     select unnest(array['cash','card','juice','bank_transfer']) as method
--
-- public.close_service builds the same list dynamically, from the payments
-- actually booked to the session, so it DOES write a points row into
-- cash_session_methods and onto the Z-report. The screen the cashier reads and
-- the report printed seconds later therefore disagreed the moment a customer
-- spent points: the takings shown at close were short by the points taken, and
-- nobody could tell whether the till was wrong or the report was.
--
-- The literal is replaced with the same subquery close_service uses, so a
-- method appears on the screen exactly when it appears on the report — and any
-- tender added after this one is picked up by both without another migration.
--
-- 'cash' is unioned in unconditionally, as close_service does: a service that
-- took no cash still has a drawer to count, an opening float to carry, and a
-- closing float to hand on.
--
-- NOT AT RISK, and deliberately untouched: expected_cash. Both this function
-- and close_cash_session filter it on method = 'cash', so the figure a cashier
-- is asked to count against never included points and still does not. Points
-- are a tender, not cash in a drawer — they belong in the means-of-payment
-- breakdown and nowhere near the physical count.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pre_close_summary';
  if v_def is null then raise exception 'public.pre_close_summary not found'; end if;
  if position('select distinct pm.method::text' in v_def) > 0 then return; end if;

  if position('select unnest(array[''cash'',''card'',''juice'',''bank_transfer'']) as method' in v_def) = 0 then
    raise exception 'pre_close_summary: hardcoded method list not found — points would still be missing from the cash-up';
  end if;

  v_def := replace(
    v_def,
    'select unnest(array[''cash'',''card'',''juice'',''bank_transfer'']) as method',
    -- Exactly what close_service does, so the screen and the report cannot drift.
    'select distinct pm.method::text as method
          from public.payments pm
         where pm.booked_session_id = p_session_id
        union select ''cash'''
  );

  execute v_def;
end $$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pre_close_summary';

  if position('select distinct pm.method::text' in v_def) = 0 then
    raise exception 'pre_close_summary still reads a fixed list of methods';
  end if;
  -- The drawer count must still be cash and only cash.
  if position('pm.method = ''cash''' in v_def) = 0 then
    raise exception 'pre_close_summary lost its cash-only expected_cash filter';
  end if;
end $$;
