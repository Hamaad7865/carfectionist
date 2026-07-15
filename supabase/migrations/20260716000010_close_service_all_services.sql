-- ═══════════════════════════════════════════════════════════════════════════
-- close_service — print EVERY service of the day, like Cashmag
--
-- Closing a service used to freeze only that one service's block, so the slip read
-- "Service 2" alone. The owner's Cashmag prints every service of the period on each
-- close. So the frozen totals now also carry:
--   • services[] — one block per closed session of the day (Service 1, 2, …), and
--   • period     — the running day aggregate (the "Period" total on the slip).
-- The per-service top-level stays intact so close_day still reads it. Body is otherwise
-- byte-for-byte the deployed definition.
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
      v_remit := case when v_m.method = any(p_remit) then p_counted_cash else 0 end;
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
  v_totals := app.z_totals(v_tenant, p_session_id, null, v_now);
  v_totals := v_totals || jsonb_build_object(
    'scope', 'service',
    'service_no', v_sess.service_no,
    'device', v_sess.device_id,
    'opened_at', v_sess.opened_at,
    'closed_at', v_sess.closed_at,
    'float_initial', v_sess.opening_float,
    'float_final', (select float_out from public.cash_session_methods
                     where cash_session_id = p_session_id and method = 'cash'),
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
  -- (each closed session's block) plus the running period aggregate.
  v_totals := v_totals || jsonb_build_object(
    'period', app.z_totals(v_tenant, null, v_sess.trading_day_id, v_now),
    'services', coalesce((
      select jsonb_agg(
               app.z_totals(v_tenant, s3.id, null, v_now) || jsonb_build_object(
                 'service_no',    s3.service_no,
                 'device',        s3.device_id,
                 'float_initial', s3.opening_float,
                 'float_final',   (select csm.float_out from public.cash_session_methods csm
                                    where csm.cash_session_id = s3.id and csm.method = 'cash'),
                 'counted_cash',  s3.closing_count,
                 'variance',      s3.variance
               ) order by s3.service_no)
        from public.cash_sessions s3
       where s3.tenant_id = v_tenant and s3.trading_day_id = v_sess.trading_day_id
         and s3.status = 'closed'
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
