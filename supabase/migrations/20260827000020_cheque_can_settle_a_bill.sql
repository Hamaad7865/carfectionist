-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a cheque can settle a bill.
--
-- 20260827000010 added 'cheque' to payment_method. Two things still reject it,
-- both because its reference is optional where card/Juice/bank demand one:
--
--   1. payments_check3 — `method = 'cash' OR reverses_payment_id IS NOT NULL OR
--      external_ref IS NOT NULL OR method = 'points'`. A cheque with no number
--      typed has none of these, so the table itself rejects the row with
--      "violates check constraint payments_check3" — exactly the wall 'points'
--      hit in 20260811000040. Widened here to name 'cheque' too. Widening a
--      CHECK can never invalidate a row that already satisfied it, so this is
--      safe against the live table.
--
--   2. record_payment's non-cash else-branch raises 'a % payment requires an
--      external reference' for every method that is not cash or points. Spliced
--      below so it makes an exception for 'cheque' — a cheque MAY carry a
--      number (kept when typed), but is not forced to.
--
-- record_payment has been rebuilt several times (till lock 20260730000010, then
-- the points splices 20260811000040 / 000070); the live body is the only
-- trustworthy description of it. The anchor is verified against what is actually
-- installed before it is touched, and an assertion afterward proves the splice
-- landed.
--
-- NOT TOUCHED, deliberately: pre_close_summary and close_service already build
-- their method list dynamically from the payments booked to the session (points
-- migration 20260811000080), so a cheque appears on the cash-up and the Z-report
-- with no change here. expected_cash stays filtered to method = 'cash' — a
-- cheque is a tender, not cash in the drawer. Reversal and credit-note paths
-- branch on `method = 'cash'`; a cheque takes the non-cash branch, same as a
-- card, and needs nothing new.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the payments table's own copy of the "cite something" rule ───────────
alter table public.payments drop constraint if exists payments_check3;
alter table public.payments add constraint payments_check3
  check (method = 'cash'
         or reverses_payment_id is not null
         or external_ref is not null
         or method = 'points'
         or method = 'cheque');

-- ── 2. splice the cheque exception into record_payment's external-ref branch ──
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_payment';
  if v_def is null then raise exception 'public.record_payment not found'; end if;
  if position('p_method <> ''cheque''' in v_def) > 0 then return; end if;

  if position('if p_external_ref is null then raise exception ''a % payment requires an external reference''' in v_def) = 0 then
    raise exception 'record_payment: the external-ref anchor was not found — repair it before splicing onto it';
  end if;

  v_def := replace(
    v_def,
    'if p_external_ref is null then raise exception ''a % payment requires an external reference'', p_method; end if;',
    'if p_external_ref is null and p_method <> ''cheque'' then raise exception ''a % payment requires an external reference'', p_method; end if;'
  );

  execute v_def;
end $$;

-- ── 3. prove it against what is actually installed ─────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_payment';

  if position('p_method <> ''cheque''' in v_def) = 0 then
    raise exception 'record_payment: cheque exception did not splice in';
  end if;
  -- the generic requirement must still stand for card / Juice / bank
  if position('a % payment requires an external reference' in v_def) = 0 then
    raise exception 'record_payment: the external-ref requirement went missing';
  end if;
end $$;
