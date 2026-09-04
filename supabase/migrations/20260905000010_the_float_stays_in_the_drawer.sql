-- ═══════════════════════════════════════════════════════════════════════════
-- The standing float stays in the drawer — "Final cash float" is not always 0.00
--
-- Ticking CASH on "CHECK YOUR CASH REGISTER BEFORE CLOSING" banked the WHOLE
-- counted drawer, float and all:
--
--     v_remit := p_counted_cash;        v_out := p_counted_cash - v_remit;  -- → 0
--
-- so cash_session_methods.float_out came out 0.00 on every close, and float_out
-- is what the Z freezes as `float_final`. Every Z since 26 Aug prints
-- "Final cash float  Rs 0.00" — Z000070 banked Rs 15,289.99 of a drawer that had
-- Rs 2,000 of float in it. Only Z000003, where CASH was left unticked, ever
-- carried a figure.
--
-- The shop runs a standing float: it is typed in every morning (2,000.00 on every
-- session on record) and physically stays in the till. So banking cash banks the
-- TAKINGS — what the drawer holds ABOVE the float — and the float is carried on:
--
--     Initial cash float   2,000.00
--     Final cash float     2,000.00      ← the Cashmag reading of a normal day
--
-- greatest(…, 0), not a bare subtraction: a short drawer (counted 1,500 against a
-- 2,000 float) must not remit a negative amount. Nothing goes to the bank, what is
-- there stays, and the shortfall is already on the Z as the variance.
--
-- Untouched: an UNTICKED cash row still carries the whole count forward (remit 0,
-- float_out = counted), and every non-cash method still banks its full accumulation.
-- Nothing recomputes an already-cut Z — those totals are frozen and stay 0.00.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'close_service';
  if v_def is null then raise exception 'public.close_service not found'; end if;
  if position('greatest(p_counted_cash - v_sess.opening_float, 0)' in v_def) > 0 then return; end if;

  if position('v_remit := case when v_m.method = any(p_remit) then p_counted_cash else 0 end;' in v_def) = 0 then
    raise exception 'close_service: the cash remittance line is not what this migration was written against — the float would still be swept to the bank';
  end if;

  v_def := replace(
    v_def,
    'v_remit := case when v_m.method = any(p_remit) then p_counted_cash else 0 end;',
    'v_remit := case when v_m.method = any(p_remit) then greatest(p_counted_cash - v_sess.opening_float, 0) else 0 end;'
  );

  execute v_def;
end $$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'close_service';

  if position('greatest(p_counted_cash - v_sess.opening_float, 0)' in v_def) = 0 then
    raise exception 'close_service still banks the whole drawer — the float would keep coming out as 0.00';
  end if;
  -- The Z must still freeze the cash row's float_out as float_final, or the corrected
  -- figure would never reach the slip.
  if position('''float_final''' in v_def) = 0 then
    raise exception 'close_service lost float_final from the frozen totals';
  end if;
  -- A non-cash method still banks its whole accumulation.
  if position('v_remit := case when v_m.method = any(p_remit) then v_float_in + v_take else 0 end;' in v_def) = 0 then
    raise exception 'close_service: the non-cash remittance branch was altered';
  end if;
end $$;
