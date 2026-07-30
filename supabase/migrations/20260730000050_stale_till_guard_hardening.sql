-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — stale-till guard, part 2: the two gaps the adversarial
-- review of 20260730000040 found.
--
-- 1. Payments. The staleness rule only covered ringing SALES (issue_document,
--    create_and_issue_credit_note). But a stale till can also take money
--    without a sale: record_payment on an old invoice, or reverse_payment —
--    both INSERT into payments with booked_session_id set, and both would file
--    that money under yesterday's Z. Their shared chokepoint is the
--    trg_payments_day_open trigger (app.guard_day_open), so the staleness
--    check goes there: every route into payments is covered at once.
--
-- 2. Replays. issue_document ran app.assert_day_open BEFORE its
--    idempotency-key replay branch. A delayed retry of an ALREADY-issued sale
--    (lost-response recovery) would now hit the staleness error even though
--    nothing new would be written — the client deserves the cached invoice
--    back, not a lecture about the till. The guard moves BELOW the replay
--    short-circuit: replays return instantly, fresh issues stay guarded.
--    Spliced from the live definition so nothing else in the function drifts.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. every payment insert that files to a till ────────────────────────────
create or replace function app.guard_day_open() returns trigger
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_closed boolean;
begin
  select d.status = 'closed' into v_closed
    from public.cash_sessions s join public.trading_days d on d.id = s.trading_day_id
   where s.id = new.booked_session_id;
  if coalesce(v_closed, false) then
    raise exception 'the day is closed — no more entries or transactions are possible';
  end if;
  -- A still-open day can be the WRONG day — same rule as ringing a sale.
  perform app.assert_till_day_current(new.booked_session_id);
  return new;
end $$;

-- ── 2. replay-before-guard in issue_document ────────────────────────────────
do $$
declare
  v_def text;
  v_guard constant text := E'\n  -- A closed day takes no more money — and ringing a new ticket is taking money.\n  perform app.assert_day_open(v_tenant, p_session_id);\n';
  v_anchor constant text := E'  select * into v_doc from public.documents\n   where id = p_document_id and tenant_id = v_tenant for update;';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'issue_document';
  if v_def is null then raise exception 'public.issue_document not found'; end if;

  if position(v_guard in v_def) > 0 and position(v_anchor in v_def) > 0 then
    v_def := replace(v_def, v_guard, E'\n');                    -- out from before the replay…
    v_def := replace(v_def, v_anchor, v_guard || E'\n' || v_anchor); -- …in after it
    execute v_def;
  elsif position('assert_day_open' in v_def) = 0 then
    raise exception 'issue_document has no assert_day_open call at all — refusing to guess';
  else
    -- Guard already sits after the replay (re-run, or a future rewrite kept it there).
    raise notice 'issue_document already in the desired shape — nothing to do';
  end if;
end $$;
