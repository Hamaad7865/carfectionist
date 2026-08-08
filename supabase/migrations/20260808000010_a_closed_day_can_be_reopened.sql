-- A closed day can be reopened from the till.
--
-- reopen_day() has existed since 20260714000006 and does the right thing, but it
-- takes the day's id — and nothing in either client knows that id when the day is
-- already shut. close_day() gets it off the Z it has just cut; a reopen has no Z in
-- hand, only "today". So the shop had no way back in: the server told the cashier
-- "reopen it before taking any more money" and the app offered no button, because
-- there was none to offer. A late customer needed someone on a database console.
--
-- The client must NOT work out which day "today" is. issue_document was already
-- bitten by exactly that (current_date is the DB's UTC day, so evening sales filed a
-- day early) and a tablet's clock is worse. app.mu_today() is the one authority, so
-- resolve the day here and let the client say only *why*.
create or replace function public.reopen_today(p_reason text)
returns trading_days language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_day    public.trading_days;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  -- Checked here as well as inside reopen_day, so a cashier is told they lack the
  -- privilege rather than which days exist.
  perform app.require_role('owner','manager');

  select * into v_day from public.trading_days
   where tenant_id = v_tenant and business_date = app.mu_today();

  -- Nothing to reopen: no till has opened today at all. Opening one is the fix, and
  -- open_cash_session mints the day itself — saying so beats a bare "day not found".
  if not found then
    raise exception 'no trading day has been opened today — just open the till';
  end if;

  -- Idempotent, like reopen_day: a second tap on a day already open is not an error.
  if v_day.status <> 'closed' then return v_day; end if;

  return public.reopen_day(v_day.id, p_reason);
end $function$;

grant execute on function public.reopen_today(text) to authenticated;
