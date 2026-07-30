-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a forgotten till cannot quietly trade on yesterday's day
--
-- What happened (30 Jul 2026): TAB-84A1's service was opened on the 29th and
-- never closed. The next afternoon four real sales rang through it, inherited
-- the session's trading day, and were stamped business_day = 2026-07-29 — so
-- the 30th's Sales Journal showed 3 tickets while the tickets list showed 7,
-- and the missing Rs 26,583.21 sat on the wrong day's books.
--
-- Booking a sale to the till's OPEN trading day is deliberate (audit #2: a sale
-- rung at 1am on a till opened before midnight belongs to that evening, not to
-- the new calendar date). The bug is only the unbounded version of it: a till
-- abandoned since yesterday afternoon is not late-night trading, it is a
-- forgotten close.
--
-- The line between the two is drawn at 06:00 Mauritius time:
--   • before 06:00 — the till's day may lag the calendar date; genuine
--     overnight trading keeps booking to the evening it belongs to;
--   • from 06:00   — a till whose trading day is older than today is stale, and
--     ringing money on it stops with an instruction to close it first.
--
-- Enforced in the shared RPCs so web and Android get it for free:
--   • app.assert_day_open       (called by issue_document — every sale)
--   • create_and_issue_credit_note (refunds stamp business_day the same way)
-- Closing the stale service and opening a fresh one stays allowed — that IS the
-- fix path, and open_cash_session already lands the new service on today.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The check itself ─────────────────────────────────────────────────────────
create or replace function app.assert_till_day_current(p_session uuid) returns void
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare v_date date;
begin
  if p_session is null then return; end if; -- back-office sale: business_day = today, nothing to drift

  select td.business_date into v_date
    from public.cash_sessions cs
    join public.trading_days td on td.id = cs.trading_day_id
   where cs.id = p_session;
  if v_date is null then return; end if; -- unknown session / no day: other guards own that error

  if v_date < app.mu_today()
     and (now() at time zone 'Indian/Mauritius')::time >= time '06:00' then
    raise exception 'this till is still on the day of % — close that service on the till, then open a new one, before taking today''s money', v_date;
  end if;
end $$;

-- ── Every sale: issue_document already funnels through assert_day_open ───────
create or replace function app.assert_day_open(p_tenant uuid, p_session uuid default null::uuid)
returns void
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_closed boolean;
begin
  if p_session is not null then
    select d.status = 'closed' into v_closed
      from public.cash_sessions s join public.trading_days d on d.id = s.trading_day_id
     where s.id = p_session;
    if coalesce(v_closed, false) then
      raise exception 'the day is closed — no more entries or transactions are possible';
    end if;
    -- A still-open day can be the WRONG day: a service forgotten since
    -- yesterday would file today's money under yesterday's journal and Z.
    perform app.assert_till_day_current(p_session);
  end if;
  select status = 'closed' into v_closed from public.trading_days
   where tenant_id = p_tenant and business_date = app.mu_today();
  if coalesce(v_closed, false) then
    raise exception 'the day is closed — no more entries or transactions are possible';
  end if;
end $$;

-- ── Refunds: create_and_issue_credit_note stamps business_day the same way ──
-- Re-issued from the live definition with ONE line added after the session
-- check (a refund on a stale till would drift to yesterday exactly like a
-- sale). Splicing instead of restating so nothing else in the function drifts.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_and_issue_credit_note';

  if v_def is null then raise exception 'public.create_and_issue_credit_note not found'; end if;

  if position('assert_till_day_current' in v_def) = 0 then
    v_def := replace(
      v_def,
      ') then raise exception ''unknown or closed cash session''; end if;',
      ') then raise exception ''unknown or closed cash session''; end if;
  perform app.assert_till_day_current(p_session_id);'
    );
    if position('assert_till_day_current' in v_def) = 0 then
      raise exception 'splice anchor not found in create_and_issue_credit_note — guard NOT installed';
    end if;
    execute v_def;
  end if;
end $$;
