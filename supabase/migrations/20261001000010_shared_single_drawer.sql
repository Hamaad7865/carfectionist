-- ═══════════════════════════════════════════════════════════════════════════
-- One drawer: the terminal and the web share a single till session.
--
-- Until now every device opened its own session (TAB-84A1 → Service 1, the web's
-- 'back-office' → Service 2, …), but the shop has ONE physical drawer. Two
-- sessions each carrying their own float/expected/count cannot share it — and
-- the Z split into parallel services the owner had to reconcile by hand
-- (2026-09-25: Service 1 + 2 + 3 for one drawer).
--
-- From here on there is at most one open session per trading day:
--   • open_cash_session refuses when today's till is already open on ANY device
--     ("the till is already open — join it instead of opening another"). The
--     clients join the open session instead of minting their own.
--   • Strict mornings (owner's choice): no new till while a STALE session is
--     still open — yesterday's drawer must be counted and closed on the terminal
--     first. The web's old silent roll-forward is gone for exactly this reason:
--     it moved money into a fresh session without counting the drawer.
--   • shop_till() is the shared lookup both clients use: today's open session
--     (any device), or null. It never opens or creates anything.
--   • back_office_till() keeps its name (the web calls it) but joins the shared
--     model: today's open session wins regardless of device; a stale open
--     session raises instead of being quietly closed at book value; otherwise it
--     opens a fresh 'back-office' session the terminal then joins.
--
-- Lock-then-check inside open_cash_session is the race backstop (same pattern
-- as the service_no minting, audit #9).
-- Quotation-only devices still never open (guard untouched). Frozen Z history
-- untouched. The 2026-08-11 drifted open back-office session stays open until
-- someone counts it — the first open attempt after this push will say so.
-- ═══════════════════════════════════════════════════════════════════════════

-- No partial unique index for one-open-per-day: parallel opens predating this
-- rule are still live, and an index would refuse to build until someone counts
-- them. The lock-then-check below is the backstop instead.

create or replace function public.open_cash_session(p_device_id text, p_opening_float numeric)
returns cash_sessions language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_day    public.trading_days;
  v_dev    text := coalesce(nullif(p_device_id, ''), 'back-office');
  v_no     int;
  v_sess   public.cash_sessions;
  v_takes  boolean;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');
  if p_opening_float is null or p_opening_float < 0 then
    raise exception 'count the opening float before opening the till';
  end if;

  if v_dev <> 'back-office' then
    select takes_payments into v_takes from public.devices
     where tenant_id = v_tenant and device_code = v_dev for share;
    -- Null when the device has no row at all: unregistered codes keep working.
    if v_takes = false then
      raise exception 'this device does not take payments — open the till on the paying terminal';
    end if;
  end if;

  -- Strict mornings: one drawer means yesterday's uncounted drawer is today's
  -- drawer. No new till until it is counted and closed — counted, never rolled.
  if exists (select 1 from public.cash_sessions s
              join public.trading_days d on d.id = s.trading_day_id
             where s.tenant_id = v_tenant and s.status = 'open'
               and d.business_date < app.mu_today()) then
    raise exception 'yesterday''s till is still open — count and close it on the terminal first';
  end if;

  -- Opens today's day if the shop has not opened yet; refuses if the day was closed.
  select * into v_day from app.open_trading_day(v_tenant);

  -- One drawer: a till open on ANY device is the shop's till. Join it.
  -- Checked AFTER taking the per-day lock: two sides opening the same instant
  -- serialize here, and the waiter then sees the winner's committed row (same
  -- shape as the service_no minting below, audit #9).
  perform pg_advisory_xact_lock(hashtextextended(v_day.id::text, 0));
  if exists (select 1 from public.cash_sessions
              where tenant_id = v_tenant and trading_day_id = v_day.id and status = 'open') then
    raise exception 'the till is already open — join it instead of opening another';
  end if;
  select coalesce(max(service_no), 0) + 1 into v_no
    from public.cash_sessions where trading_day_id = v_day.id;

  insert into public.cash_sessions (tenant_id, device_id, opened_by, opening_float, trading_day_id, service_no)
  values (v_tenant, v_dev, app.current_app_user_id(), p_opening_float, v_day.id, v_no)
  returning * into v_sess;

  return v_sess;
exception when unique_violation then
  raise exception 'the till is already open — join it instead of opening another';
end $function$;

-- ── The shared lookup: today's open till, whoever opened it ────────────────
-- Read-only on purpose: opening is a counted act and stays behind open_cash_session.
create or replace function public.shop_till() returns public.cash_sessions
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_sess   public.cash_sessions;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');
  select s.* into v_sess
    from public.cash_sessions s
    join public.trading_days d on d.id = s.trading_day_id
   where s.tenant_id = v_tenant and s.status = 'open'
     and d.business_date = app.mu_today()
   order by s.opened_at limit 1;
  return v_sess;  -- null when the drawer is closed: the caller opens it
end $$;

revoke execute on function public.shop_till() from public;
grant execute on function public.shop_till() to authenticated;

-- ── The desk till joins the shared drawer ───────────────────────────────────
-- Same contract as before (the desk always gets a usable till) with the
-- strict rule the owner chose: a stale open session is COUNTED on the terminal,
-- never rolled forward at book value — rolling moved money into a fresh session
-- without counting the one physical drawer.
create or replace function public.back_office_till() returns public.cash_sessions
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_sess     public.cash_sessions;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  -- Today's till, whoever opened it (terminal or desk): join it.
  select s.* into v_sess
    from public.cash_sessions s
    join public.trading_days d on d.id = s.trading_day_id
   where s.tenant_id = v_tenant and s.status = 'open'
     and d.business_date = app.mu_today()
   order by s.opened_at limit 1;
  if found then return v_sess; end if;

  -- A stale open session owns the drawer until it is counted. Strict: refuse.
  if exists (select 1 from public.cash_sessions s
              join public.trading_days d on d.id = s.trading_day_id
             where s.tenant_id = v_tenant and s.status = 'open'
               and d.business_date < app.mu_today()) then
    raise exception 'yesterday''s till is still open — count and close it on the terminal first';
  end if;

  -- Drawer closed and no stale till: open the desk's own. The terminal joins it.
  -- A terminal opening the same instant wins the race: join its till instead.
  begin
    return public.open_cash_session('back-office', 0);
  exception when others then
    if sqlerrm like '%already open%' then
      select s.* into v_sess
        from public.cash_sessions s
        join public.trading_days d on d.id = s.trading_day_id
       where s.tenant_id = v_tenant and s.status = 'open'
         and d.business_date = app.mu_today()
       order by s.opened_at limit 1;
      if found then return v_sess; end if;
    end if;
    raise;
  end;
end $$;

-- ── prove the shape ─────────────────────────────────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'open_cash_session';
  if position('trading_day_id = v_day.id and status = ''open''' in v_def) = 0 then
    raise exception 'open_cash_session lost the one-drawer open check';
  end if;
  if position('and device_id = v_dev and status = ''open''' in v_def) > 0 then
    raise exception 'open_cash_session still checks per-device — parallel tills would open again';
  end if;
  if position('yesterday''''s till is still open' in v_def) = 0 then
    raise exception 'open_cash_session lost the strict stale check';
  end if;
  if position('takes_payments' in v_def) = 0 then
    raise exception 'open_cash_session lost the quotation-only guard';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'shop_till';
  if v_def is null then raise exception 'public.shop_till not found'; end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'back_office_till';
  if position('yesterday''''s till is still open' in v_def) = 0 then
    raise exception 'back_office_till lost the strict stale refusal';
  end if;
end $$;
