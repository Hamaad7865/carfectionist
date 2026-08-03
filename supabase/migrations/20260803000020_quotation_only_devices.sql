-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a device that does not take money is never asked to open a till
--
-- The Samsung is reception's tablet: intake, quotations, jobs. It never charges
-- anyone. But Checkout was its landing screen and showed "Till closed — open it"
-- in warning orange, so staff opened a session out of habit, nobody closed it,
-- and the forgotten service is exactly what 20260730000040_stale_till_guard.sql
-- was written for — a till trading on yesterday's day.
--
-- A switch the staff can flip themselves does not break a staff habit. So the
-- fact lives on the device row and the refusal lives in open_cash_session, the
-- one choke point web and Android already share.
--
-- Defaults to true: every device registered today keeps behaving exactly as it
-- does now until the owner flips one in Points of Sale → device → Settings.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.devices
  add column if not exists takes_payments boolean not null default true;

comment on column public.devices.takes_payments is
  'false = quotation-only terminal: open_cash_session refuses it and the tablet hides Checkout.';

-- ── set_device_takes_payments (owner/manager, Settings tab) ─────────────────
-- Refuses to switch OFF while the device holds an open session: the flip would
-- strand that session on a tablet whose till screen has just disappeared —
-- open forever, closable from nowhere.
create or replace function public.set_device_takes_payments(p_device_id uuid, p_takes boolean)
returns public.devices language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_dev    public.devices;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

  select * into v_dev from public.devices
   where id = p_device_id and tenant_id = v_tenant for update;
  if not found then raise exception 'device not found'; end if;

  if p_takes = false and exists (
    select 1 from public.cash_sessions
     where tenant_id = v_tenant and device_id = v_dev.device_code and status = 'open'
  ) then
    raise exception 'close the open service on this device first — it still holds today''s takings';
  end if;

  update public.devices set takes_payments = p_takes
   where id = v_dev.id
   returning * into v_dev;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload, device_id)
  values (v_tenant, v_actor,
          case when p_takes then 'device_payments_enabled' else 'device_payments_disabled' end,
          'device', v_dev.id, jsonb_build_object('device_code', v_dev.device_code), v_dev.device_code);

  return v_dev;
end $$;
revoke execute on function public.set_device_takes_payments(uuid, boolean) from public;
grant  execute on function public.set_device_takes_payments(uuid, boolean) to authenticated;

-- ── open_cash_session: the refusal ─────────────────────────────────────────
-- Unchanged from 20260714000006 except the takes_payments block. Scoped to
-- REGISTERED devices by construction: 'back-office' and any pre-registry
-- device code have no devices row, match nothing, and are unaffected.
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

  if exists (select 1 from public.devices
              where tenant_id = v_tenant and device_code = v_dev
                and takes_payments = false) then
    raise exception 'this device does not take payments — open the till on the paying terminal';
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
