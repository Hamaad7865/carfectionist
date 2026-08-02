-- ═══════════════════════════════════════════════════════════════════════════
-- close_day — the frozen Z answers a RETRY, never a STALE register
--
-- close_day is idempotent on an already-closed day: it hands back the day's old
-- frozen Z so a double-tap or a lost response can't fail. But the tablet passes a
-- trading-day id it cached at screen entry, and that cache can be a day old (a
-- tablet left on the till screen overnight; the day closed from another device).
-- Replaying the old Z then made "close the day" a silent no-op against the WRONG
-- day: the operator read success while the current day stayed open.
--
-- A newer trading day can only exist once the calendar moved on (open_trading_day
-- creates one row per date), so its existence proves the caller is stale, not
-- retrying. Guard added; body is otherwise byte-for-byte the deployed definition.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.close_day(p_day_id uuid)
returns z_reports language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_day    public.trading_days;
  v_open   text;
  v_now    timestamptz := now();
  v_totals jsonb;
  v_z      public.z_reports;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

  select * into v_day from public.trading_days where id = p_day_id and tenant_id = v_tenant for update;
  if not found then raise exception 'day not found'; end if;
  if v_day.status = 'closed' then
    -- Stale register, not a retry: a genuine retry never sees a newer day.
    if exists (select 1 from public.trading_days
                where tenant_id = v_tenant and business_date > v_day.business_date) then
      raise exception 'day % is already closed and a newer day exists — this register was on a stale day; back out and close the current day', v_day.business_date;
    end if;
    select * into v_z from public.z_reports where trading_day_id = p_day_id and scope = 'day'
     order by closed_at desc limit 1;
    if found then return v_z; end if;
    raise exception 'the day is already closed';
  end if;

  -- Every till has to be counted before the day can be sealed.
  select string_agg(device_id, ', ') into v_open
    from public.cash_sessions where trading_day_id = p_day_id and status = 'open';
  if v_open is not null then
    raise exception 'close the till(s) first: %', v_open;
  end if;

  v_totals := app.z_totals(v_tenant, null, p_day_id, v_now);
  v_totals := v_totals || jsonb_build_object(
    'scope', 'day',
    'business_date', v_day.business_date,
    'closed_at', v_now,
    -- Every service of the day, so the slip can print "Service 1/2/3" then "Period".
    'services', coalesce((select jsonb_agg(z.totals order by (z.totals->>'service_no')::int)
                            from public.z_reports z
                           where z.trading_day_id = p_day_id and z.scope = 'service'), '[]'::jsonb)
  );

  insert into public.z_reports (tenant_id, number, scope, cash_session_id, trading_day_id, totals, closed_at, closed_by)
  values (v_tenant, app.next_z_number(v_tenant), 'day', null, p_day_id, v_totals, v_now, v_actor)
  returning * into v_z;

  update public.trading_days
     set status = 'closed', closed_at = v_now, closed_by = v_actor
   where id = p_day_id;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'day_closed', 'trading_day', p_day_id,
          jsonb_build_object('z', v_z.number, 'date', v_day.business_date, 'total', v_totals->'total_incl'));

  return v_z;
end $function$;
