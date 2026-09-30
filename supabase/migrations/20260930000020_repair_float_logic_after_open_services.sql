-- ═══════════════════════════════════════════════════════════════════════════
-- Repair: re-apply the float patches that 20260930000010 dropped.
--
-- That migration rebuilt close_service from the 20260716000010 text, silently
-- reverting two live patches (caught by _verify-final-float-whole-drawer):
--   • 20260905000010 (float stays in the drawer): ticking CASH banks the TAKINGS
--     (greatest(counted - opening, 0)), not the whole drawer. The regressed body
--     banked p_counted_cash outright — every close would sweep the Rs 2,000 float.
--   • 20260909000040 (final float is the whole drawer): float_final reads the
--     COUNTED drawer (closing_count), not the cash row's float_out. The regressed
--     body read float_out again, so Final would print the standing float.
--
-- This restores both on top of the open-services shape (ALL sessions in
-- services[], open ones provisional with null counted/variance/float_final).
-- No real close ran on the regressed body (pushed and repaired within the hour;
-- verified: no z_reports rows cut between the two pushes). Frozen history untouched.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.close_service(
  p_session_id  uuid,
  p_counted_cash numeric,
  p_remit       text[] default '{}',
  p_note        text default null
) returns z_reports
language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_actor   uuid := app.current_app_user_id();
  v_sess    public.cash_sessions;
  v_prev    record;
  v_m       record;
  v_now     timestamptz := now();
  v_totals  jsonb;
  v_z       public.z_reports;
  v_pending int;
  v_float_in numeric;
  v_take    numeric;
  v_remit   numeric;
  v_out     numeric;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_sess from public.cash_sessions
   where id = p_session_id and tenant_id = v_tenant for update;
  if not found then raise exception 'till not found'; end if;
  if v_sess.status = 'closed' then
    select * into v_z from public.z_reports where cash_session_id = p_session_id and scope = 'service';
    if found then return v_z; end if;   -- idempotent: hand back the Z it already cut
    raise exception 'this till is already closed';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'count the drawer before closing';
  end if;

  select count(*) into v_pending from public.documents
   where tenant_id = v_tenant and doc_type = 'invoice' and status = 'draft'
     and cash_session_id = p_session_id;
  if v_pending > 0 then
    raise exception 'cannot close: % unfinished bill(s) on this till — finish or delete them first', v_pending;
  end if;

  for v_m in
    select m.method
      from (
        select distinct pm.method::text as method from public.payments pm
         where pm.booked_session_id = p_session_id
        union select 'cash'
      ) m
  loop
    select coalesce(csm.float_out, 0) into v_float_in
      from public.cash_session_methods csm
      join public.cash_sessions s2 on s2.id = csm.cash_session_id
     where s2.device_id = v_sess.device_id and s2.tenant_id = v_tenant
       and s2.status = 'closed' and csm.method = v_m.method
     order by s2.closed_at desc limit 1;
    v_float_in := coalesce(v_float_in, case when v_m.method = 'cash' then v_sess.opening_float else 0 end);

    select coalesce(sum(pm.amount), 0) into v_take
      from public.payments pm
     where pm.booked_session_id = p_session_id and pm.method::text = v_m.method;

    if v_m.method = 'cash' then
      -- 20260905000010: the standing float stays in the drawer — banking cash banks
      -- the TAKINGS above the float, never the float itself. greatest(…, 0): a short
      -- drawer remits nothing instead of a negative amount.
      v_remit := case when v_m.method = any(p_remit) then greatest(p_counted_cash - v_sess.opening_float, 0) else 0 end;
      v_out   := p_counted_cash - v_remit;
      insert into public.cash_session_methods
        (tenant_id, cash_session_id, method, float_in, takings, counted, remitted, float_out)
      values (v_tenant, p_session_id, v_m.method, v_sess.opening_float, v_take, p_counted_cash, v_remit, v_out);
    else
      v_remit := case when v_m.method = any(p_remit) then v_float_in + v_take else 0 end;
      v_out   := v_float_in + v_take - v_remit;
      insert into public.cash_session_methods
        (tenant_id, cash_session_id, method, float_in, takings, counted, remitted, float_out)
      values (v_tenant, p_session_id, v_m.method, v_float_in, v_take, null, v_remit, v_out);
    end if;

    if v_remit > 0 then
      insert into public.bank_remittances (tenant_id, cash_session_id, method, amount, created_by)
      values (v_tenant, p_session_id, v_m.method, v_remit, v_actor);
    end if;
  end loop;

  perform public.close_cash_session(p_session_id, p_counted_cash);
  select * into v_sess from public.cash_sessions where id = p_session_id;

  -- Freeze the report as the world is right now. Top-level stays the closed service.
  -- 20260909000040: float_final is the whole drawer COUNTED at close, decoupled from
  -- float_out (which carries the standing float forward).
  v_totals := app.z_totals(v_tenant, p_session_id, null, v_now);
  v_totals := v_totals || jsonb_build_object(
    'scope', 'service',
    'service_no', v_sess.service_no,
    'device', v_sess.device_id,
    'opened_at', v_sess.opened_at,
    'closed_at', v_sess.closed_at,
    'float_initial', v_sess.opening_float,
    'float_final', v_sess.closing_count,
    'counted_cash', v_sess.closing_count,
    'expected_cash', v_sess.expected_cash,
    'variance', v_sess.variance,
    'remittances', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'amount', amount))
                               from public.bank_remittances where cash_session_id = p_session_id), '[]'::jsonb),
    'accumulation', coalesce((select jsonb_agg(jsonb_build_object(
                                'method', method, 'float_in', float_in, 'takings', takings,
                                'remitted', remitted, 'float_out', float_out) order by method)
                               from public.cash_session_methods where cash_session_id = p_session_id), '[]'::jsonb)
  );

  -- Cashmag prints every service of the day on each close: carry the full service list
  -- plus the running period aggregate. ALL sessions — a still-open till (e.g. the
  -- back-office) prints as a provisional block so the breakdown reconciles with the
  -- Period instead of silently omitting its sales. Open sessions have no counted
  -- drawer yet, so counted/variance/float_final stay null and clients must skip them.
  v_totals := v_totals || jsonb_build_object(
    'period', app.z_totals(v_tenant, null, v_sess.trading_day_id, v_now),
    'services', coalesce((
      select jsonb_agg(
               app.z_totals(v_tenant, s3.id, null, v_now) || jsonb_build_object(
                 'service_no',    s3.service_no,
                 'device',        s3.device_id,
                 'status',        s3.status,
                 'provisional',   (s3.status = 'open'),
                 'float_initial', s3.opening_float,
                 'float_final',   s3.closing_count,
                 'counted_cash',  s3.closing_count,
                 'variance',      s3.variance
               ) order by s3.service_no)
        from public.cash_sessions s3
       where s3.tenant_id = v_tenant and s3.trading_day_id = v_sess.trading_day_id
    ), '[]'::jsonb)
  );

  insert into public.z_reports (tenant_id, number, scope, cash_session_id, trading_day_id, totals, note, closed_at, closed_by)
  values (v_tenant, app.next_z_number(v_tenant), 'service', p_session_id, v_sess.trading_day_id, v_totals, nullif(trim(coalesce(p_note,'')), ''), v_now, v_actor)
  returning * into v_z;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'service_closed', 'cash_session', p_session_id,
          jsonb_build_object('z', v_z.number, 'service_no', v_sess.service_no,
                             'counted', p_counted_cash, 'variance', v_sess.variance, 'remitted', p_remit));

  return v_z;
end $function$;

-- Same whole-drawer reading for the day close's service blocks: at close_day time
-- every session is counted (the guard above refuses otherwise), so closing_count
-- is set — but the 20260930000010 body read float_out again. Keep Final == Counted.
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
    -- Every service of the day, built live from its sessions — never from the Z rows,
    -- so a session closed without cutting a Z (the web's old close path) still prints.
    'services', coalesce((
      select jsonb_agg(
               app.z_totals(v_tenant, s3.id, null, v_now) || jsonb_build_object(
                 'service_no',    s3.service_no,
                 'device',        s3.device_id,
                 'status',        s3.status,
                 'provisional',   false,
                 'float_initial', s3.opening_float,
                 'float_final',   s3.closing_count,
                 'counted_cash',  s3.closing_count,
                 'variance',      s3.variance
               ) order by s3.service_no)
        from public.cash_sessions s3
       where s3.tenant_id = v_tenant and s3.trading_day_id = p_day_id
    ), '[]'::jsonb)
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

-- ── prove the shape (mirrors 20260909000040's guards + the open-services shape) ──
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'close_service';

  -- Float patches restored.
  if position('greatest(p_counted_cash - v_sess.opening_float, 0)' in v_def) = 0 then
    raise exception 'close_service still banks the whole drawer — the float would keep being swept to the bank';
  end if;
  if v_def ~ 'float_final''\s*,\s*\(select float_out' or v_def ~ 'float_final''\s*,\s*\(select csm\.float_out' then
    raise exception 'close_service still freezes float_final from float_out — the Final float would keep reading the standing float';
  end if;
  if position('''float_final'', v_sess.closing_count' in v_def) = 0 then
    raise exception 'close_service lost the top-level float_final';
  end if;
  if position('''float_final'',   s3.closing_count' in v_def) = 0 then
    raise exception 'close_service lost the per-service float_final';
  end if;
  -- Open-services shape kept.
  if position('''provisional'',   (s3.status = ''open'')' in v_def) = 0 then
    raise exception 'close_service lost the provisional open-service block';
  end if;
  if position('and s3.status = ''closed''' in v_def) > 0 then
    raise exception 'close_service still filters services[] to closed sessions — Service 2 would vanish again';
  end if;
end $$;
