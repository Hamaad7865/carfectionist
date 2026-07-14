-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — closing a service, and closing the day
-- ═══════════════════════════════════════════════════════════════════════════

/** Gapless Z numbers. Allocated inside the closing transaction: if the close rolls
 *  back (a pending bill, a failed guard), the number rolls back with it and the
 *  fiscal series has no hole. */
create or replace function app.next_z_number(p_tenant uuid) returns text
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_n int;
begin
  update public.business_settings set z_next_number = z_next_number + 1
   where id = p_tenant returning z_next_number - 1 into v_n;
  return 'Z' || lpad(v_n::text, 6, '0');
end $$;

-- ── open_cash_session: a service belongs to a day and is numbered in it ─────
create or replace function public.open_cash_session(p_device_id text, p_opening_float numeric)
returns cash_sessions language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_day    public.trading_days;
  v_dev    text := coalesce(nullif(p_device_id, ''), 'back-office');
  v_no     int;
  v_sess   public.cash_sessions;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');
  if p_opening_float is null or p_opening_float < 0 then
    raise exception 'count the opening float before opening the till';
  end if;

  -- Opens today's day if the shop has not opened yet; refuses if the day was closed.
  select * into v_day from app.open_trading_day(v_tenant);

  if exists (select 1 from public.cash_sessions
              where tenant_id = v_tenant and device_id = v_dev and status = 'open') then
    raise exception 'this till is already open';
  end if;

  select coalesce(max(service_no), 0) + 1 into v_no
    from public.cash_sessions where trading_day_id = v_day.id;

  insert into public.cash_sessions (tenant_id, device_id, opened_by, opening_float, trading_day_id, service_no)
  values (v_tenant, v_dev, app.current_app_user_id(), p_opening_float, v_day.id, v_no)
  returning * into v_sess;

  return v_sess;
end $function$;

-- ── close_service: count the drawer, bank what was ticked, cut the Z ────────
/**
 * p_remit is the list of methods the operator ticked on "check your cash register
 * before closing" — those are swept to the bank and their accumulation resets to zero.
 * Everything unticked keeps accumulating into the next service, which is what the
 * owner's screen shows (CASH 2000.00, MAUCAS 2365.00, JUICE 22611.50 all carried).
 */
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

  -- "NO PENDING BILL" — a DRAFT invoice is an unfinished sale, and closing over it
  -- would leave money on the counter. An unpaid ISSUED invoice is fine: that is a
  -- credit sale, and CUSTOMER CREDIT is a line on the report.
  select count(*) into v_pending from public.documents
   where tenant_id = v_tenant and doc_type = 'invoice' and status = 'draft'
     and cash_session_id = p_session_id;
  if v_pending > 0 then
    raise exception 'cannot close: % unfinished bill(s) on this till — finish or delete them first', v_pending;
  end if;

  -- ── Per-method: what came in, what is banked, what carries on.
  for v_m in
    select m.method
      from (
        select distinct pm.method::text as method from public.payments pm
         where pm.booked_session_id = p_session_id
        union select 'cash'
      ) m
  loop
    -- what this method had accumulated on THIS DEVICE at the last close
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
      -- The drawer is what was COUNTED (that is the money in the till), and the float
      -- carried on is what is left after the bank drop. Never carry "expected" — that
      -- would launder a shortage into tomorrow.
      v_remit := case when v_m.method = any(p_remit) then p_counted_cash else 0 end;
      v_out   := p_counted_cash - v_remit;
      insert into public.cash_session_methods
        (tenant_id, cash_session_id, method, float_in, takings, counted, remitted, float_out)
      values (v_tenant, p_session_id, v_m.method, v_sess.opening_float, v_take, p_counted_cash, v_remit, v_out);
    else
      -- Ticking a method banks its WHOLE accumulation, not just today's slice —
      -- otherwise the accumulation column would drift upwards for ever.
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

  -- Close the drawer (this stamps expected_cash + variance from the real rows).
  perform public.close_cash_session(p_session_id, p_counted_cash);
  select * into v_sess from public.cash_sessions where id = p_session_id;

  -- Freeze the report as the world is right now.
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

  insert into public.z_reports (tenant_id, number, scope, cash_session_id, trading_day_id, totals, note, closed_at, closed_by)
  values (v_tenant, app.next_z_number(v_tenant), 'service', p_session_id, v_sess.trading_day_id, v_totals, nullif(trim(coalesce(p_note,'')), ''), v_now, v_actor)
  returning * into v_z;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'service_closed', 'cash_session', p_session_id,
          jsonb_build_object('z', v_z.number, 'service_no', v_sess.service_no,
                             'counted', p_counted_cash, 'variance', v_sess.variance, 'remitted', p_remit));

  return v_z;
end $function$;

-- ── close_day: final. No more money until it is reopened. ───────────────────
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

/** The way back in. The owner re-enters their PIN in the app; the server records who,
 *  when and why. The day's Z stays where it is — the series is gapless, so reopening
 *  never reuses a number; closing again cuts a fresh Z that supersedes it. */
create or replace function public.reopen_day(p_day_id uuid, p_reason text)
returns trading_days language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_day    public.trading_days;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required to reopen a closed day';
  end if;

  select * into v_day from public.trading_days where id = p_day_id and tenant_id = v_tenant for update;
  if not found then raise exception 'day not found'; end if;
  if v_day.status <> 'closed' then return v_day; end if;

  update public.trading_days
     set status = 'open', closed_at = null, closed_by = null, reopened_count = reopened_count + 1
   where id = p_day_id returning * into v_day;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'day_reopened', 'trading_day', p_day_id,
          jsonb_build_object('date', v_day.business_date, 'reason', trim(p_reason), 'times_reopened', v_day.reopened_count));

  return v_day;
end $function$;
