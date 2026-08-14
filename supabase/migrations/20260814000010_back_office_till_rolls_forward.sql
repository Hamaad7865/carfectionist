-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — the back-office till rolls itself forward
--
-- The web back office is its own till: an invoice issued at the desk, a payment
-- taken there, a credit note refunded there, are all booked to a `back-office`
-- cash session so the money appears on the cash-up (Point of Sale module).
-- backOfficeTillId() reuses whatever back-office session is open — but it never
-- checked WHICH DAY that session belonged to.
--
-- So the desk till drifted straight into the stale-till guard (20260730000040):
-- the session opened the first time anyone invoiced at the desk stayed open for
-- ever, and from the next morning on `app.assert_till_day_current` refused every
-- desk invoice with "this till is still on the day of … — close that service on
-- the till, then open a new one". A tablet's cashier can do that: there is a
-- drawer to count and a Close button. The virtual desk till has neither, and in
-- practice nobody ever closes it — so back-office invoicing simply stopped
-- working, one day after it started. (Seen live 14 Aug: a tenant's desk till was
-- still open on the trading day of 11 Aug.)
--
-- The guard's own comment names the fix path: "Closing the stale service and
-- opening a fresh one stays allowed — that IS the fix path". This does exactly
-- that, automatically, for the one till no human closes. The guard itself is
-- untouched, so a real tablet till still stops and waits to be counted — which
-- is the whole point of the guard.
--
-- Web-only by design: Android tablets ring on their own physical device till and
-- must keep the manual close+count, so there is no tablet mirror of this.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The staleness rule, named once ──────────────────────────────────────────
-- Extracted from app.assert_till_day_current so the roll below and the guard
-- can never disagree about what "stale" means. Same predicate, same 06:00
-- Mauritius grace for genuine overnight trading.
create or replace function app.till_day_is_stale(p_session uuid) returns boolean
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare v_date date;
begin
  if p_session is null then return false; end if; -- no session → business_day is today, nothing to drift
  select td.business_date into v_date
    from public.cash_sessions cs
    join public.trading_days td on td.id = cs.trading_day_id
   where cs.id = p_session;
  if v_date is null then return false; end if;    -- unknown session / no day: other guards own that
  return v_date < app.mu_today()
     and (now() at time zone 'Indian/Mauritius')::time >= time '06:00';
end $$;

-- Re-issue the guard on top of the shared predicate — identical behaviour and
-- identical message, so nothing that depends on the wording changes.
create or replace function app.assert_till_day_current(p_session uuid) returns void
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare v_date date;
begin
  if not app.till_day_is_stale(p_session) then return; end if;
  select td.business_date into v_date
    from public.cash_sessions cs
    join public.trading_days td on td.id = cs.trading_day_id
   where cs.id = p_session;
  raise exception 'this till is still on the day of % — close that service on the till, then open a new one, before taking today''s money', v_date;
end $$;

-- ── The desk till, always on today ──────────────────────────────────────────
-- Returns the open back-office session for this tenant, rolling it forward first
-- if it belongs to an earlier day. The roll closes the stale session at book
-- value (expected cash exactly, so variance = 0 — nothing was miscounted, it was
-- simply carried over) and opens a fresh one on today's trading day. No Z is
-- cut: this is not the owner closing their day, it is the virtual till turning
-- over so the money keeps landing on the right day's cash-up.
create or replace function public.back_office_till() returns public.cash_sessions
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_sess     public.cash_sessions;
  v_expected numeric;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_sess
    from public.cash_sessions
   where tenant_id = v_tenant and device_id = 'back-office' and status = 'open'
   for update;

  if found then
    if not app.till_day_is_stale(v_sess.id) then
      return v_sess;                        -- today's (or an undated) session — use it
    end if;
    -- Stale: close at book value so the carry-over shows no phantom variance.
    -- Mirrors close_cash_session's expected = float + cash + till movements.
    select v_sess.opening_float
         + coalesce((select sum(amount) from public.payments
                      where cash_session_id = v_sess.id and method = 'cash'), 0)
         + coalesce((select sum(amount) from public.till_movements
                      where cash_session_id = v_sess.id), 0)
      into v_expected;
    perform public.close_cash_session(v_sess.id, v_expected);
  end if;

  -- None open, or we just retired the stale one: open today's fresh desk till.
  return public.open_cash_session('back-office', 0);
end $$;

revoke execute on function public.back_office_till() from public;
grant  execute on function public.back_office_till() to authenticated;
