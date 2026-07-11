-- ═══════════════════════════════════════════════════════════════════════════
-- Point of Sale module — device registry + monthly close.
-- Owner request (2026-07-11): a Cashmag-style "Points of Sale" back office —
-- device list with till state, per-device dashboard (General / Settings /
-- Cash Flow / Traceability) and a monthly period close. This migration lays
-- the data foundation:
--   • devices — real registry; tablets self-register via register_device()
--     on launch and heartbeat while foregrounded (drives the online dot).
--     Traceability events land in audit_events (terminal_started,
--     app_version_changed) stamped with device_id.
--   • period_closes — owner-declared monthly close: a totals SNAPSHOT +
--     audit event, NOT an enforcement lock (documents are fiscally locked on
--     issue and payments are append-only already, so nothing backdatable
--     exists to freeze). The UI recomputes live and shows a "matches ledger"
--     badge — drift detection instead of false confidence.
-- Writes go through SECURITY DEFINER RPCs only; both tables are select-only
-- to authenticated (owner/manager via RLS).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── devices ─────────────────────────────────────────────────────────────────
create table if not exists devices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references business_settings(id),
  device_code  text not null,                 -- the tablet's stable id (TAB-3F9A)
  display_name text,                          -- owner-set friendly name ("Caisse 1")
  model        text,                          -- Build.MODEL, e.g. NEOSTRA D2
  app_version  text,                          -- BuildConfig.VERSION_NAME
  is_active    boolean not null default true, -- inactive = retired/lost, out of the count
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, device_code)
);
create trigger trg_devices_updated before update on devices
  for each row execute function app.set_updated_at();

alter table devices enable row level security;
create policy dev_select on devices for select to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) in ('owner','manager'));
grant select on devices to authenticated;  -- writes only via definer RPCs below

-- ─── period_closes ───────────────────────────────────────────────────────────
create table if not exists period_closes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references business_settings(id),
  period     text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), -- 'YYYY-MM'
  closed_by  uuid references app_users(id),
  closed_at  timestamptz not null default now(),
  totals     jsonb not null default '{}',
  unique (tenant_id, period)
);
alter table period_closes enable row level security;
create policy pc_select on period_closes for select to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) in ('owner','manager'));
grant select on period_closes to authenticated;

-- ─── register_device(code, model, version, heartbeat) ───────────────────────
-- Called by the tablet: on app launch (heartbeat=false → audits terminal_started
-- and, when the version changed since last time, app_version_changed) and every
-- few minutes while foregrounded (heartbeat=true → only touches last_seen, no
-- audit spam). Any signed-in staff role may call it — registration is an
-- observation, not a privilege.
create or replace function public.register_device(
  p_code text,
  p_model text default null,
  p_version text default null,
  p_heartbeat boolean default false
) returns public.devices language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_dev    public.devices;
  v_prev_version text;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  if coalesce(trim(p_code),'') = '' then raise exception 'device code is required'; end if;
  if length(p_code) > 64 then raise exception 'device code too long'; end if;

  select * into v_dev from public.devices
   where tenant_id = v_tenant and device_code = p_code for update;

  if not found then
    insert into public.devices (tenant_id, device_code, model, app_version)
    values (v_tenant, p_code, p_model, p_version)
    returning * into v_dev;
    if not p_heartbeat then
      insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload, device_id)
      values (v_tenant, v_actor, 'terminal_started', 'device', v_dev.id,
              jsonb_build_object('device_code', p_code, 'model', p_model, 'app_version', p_version, 'first_registration', true),
              p_code);
    end if;
    return v_dev;
  end if;

  v_prev_version := v_dev.app_version;
  update public.devices
     set last_seen   = now(),
         model       = coalesce(p_model, model),
         app_version = coalesce(p_version, app_version)
   where id = v_dev.id
   returning * into v_dev;

  if not p_heartbeat then
    insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload, device_id)
    values (v_tenant, v_actor, 'terminal_started', 'device', v_dev.id,
            jsonb_build_object('device_code', p_code, 'model', v_dev.model, 'app_version', v_dev.app_version),
            p_code);
    if p_version is not null and v_prev_version is distinct from p_version then
      insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload, device_id)
      values (v_tenant, v_actor, 'app_version_changed', 'device', v_dev.id,
              jsonb_build_object('device_code', p_code, 'from', v_prev_version, 'to', p_version),
              p_code);
    end if;
  end if;

  return v_dev;
end $$;
revoke execute on function public.register_device(text, text, text, boolean) from public;
grant  execute on function public.register_device(text, text, text, boolean) to authenticated;

-- ─── rename_device / set_device_active (owner/manager, Settings tab) ────────
create or replace function public.rename_device(p_device_id uuid, p_name text)
returns public.devices language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_dev    public.devices;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');
  update public.devices set display_name = nullif(trim(p_name),'')
   where id = p_device_id and tenant_id = v_tenant
   returning * into v_dev;
  if not found then raise exception 'device not found'; end if;
  return v_dev;
end $$;
revoke execute on function public.rename_device(uuid, text) from public;
grant  execute on function public.rename_device(uuid, text) to authenticated;

create or replace function public.set_device_active(p_device_id uuid, p_active boolean)
returns public.devices language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_dev    public.devices;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');
  update public.devices set is_active = p_active
   where id = p_device_id and tenant_id = v_tenant
   returning * into v_dev;
  if not found then raise exception 'device not found'; end if;
  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload, device_id)
  values (v_tenant, v_actor, case when p_active then 'device_enabled' else 'device_disabled' end,
          'device', v_dev.id, jsonb_build_object('device_code', v_dev.device_code), v_dev.device_code);
  return v_dev;
end $$;
revoke execute on function public.set_device_active(uuid, boolean) from public;
grant  execute on function public.set_device_active(uuid, boolean) to authenticated;

-- ─── close_period('YYYY-MM') — owner-only monthly close ─────────────────────
-- Snapshots the month's totals (Mauritius calendar month, UTC+04) into
-- period_closes and logs the traceability event. Rejects a month that hasn't
-- finished yet (MU time) and a month already closed (unique constraint).
create or replace function public.close_period(p_period text)
returns public.period_closes language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_start  timestamptz;
  v_end    timestamptz;
  v_totals jsonb;
  v_row    public.period_closes;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner');
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'period must be YYYY-MM'; end if;

  -- Month bounds as MU-local midnights (Mauritius is UTC+04, no DST).
  v_start := (p_period || '-01 00:00:00+04')::timestamptz;
  v_end   := v_start + interval '1 month';
  if v_end > now() then raise exception 'period % has not finished yet', p_period; end if;

  select jsonb_build_object(
    'invoices', (
      select jsonb_build_object('count', count(*), 'revenue', coalesce(sum(total_incl),0), 'vat', coalesce(sum(vat_total),0))
      from public.documents
      where tenant_id = v_tenant and doc_type = 'invoice' and status <> 'void'
        and issued_at >= v_start and issued_at < v_end
    ),
    'credit_notes', (
      select jsonb_build_object('count', count(*), 'amount', coalesce(sum(total_incl),0))
      from public.documents
      where tenant_id = v_tenant and doc_type = 'credit_note' and status <> 'void'
        and issued_at >= v_start and issued_at < v_end
    ),
    'payments_by_method', (
      select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb)
      from (select method::text, sum(amount) amt
            from public.payments
            where tenant_id = v_tenant and received_at >= v_start and received_at < v_end
            group by method) m
    ),
    'takings_by_device', (
      select coalesce(jsonb_object_agg(dev, amt), '{}'::jsonb)
      from (select coalesce(cs.device_id, 'unattributed') dev, sum(p.amount) amt
            from public.payments p
            left join public.cash_sessions cs on cs.id = p.cash_session_id
            where p.tenant_id = v_tenant and p.received_at >= v_start and p.received_at < v_end
            group by 1) d
    )
  ) into v_totals;

  insert into public.period_closes (tenant_id, period, closed_by, totals)
  values (v_tenant, p_period, v_actor, v_totals)
  returning * into v_row;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'period_closed', 'period_close', v_row.id,
          jsonb_build_object('period', p_period, 'totals', v_totals));

  return v_row;
exception when unique_violation then
  raise exception 'period % is already closed', p_period;
end $$;
revoke execute on function public.close_period(text) from public;
grant  execute on function public.close_period(text) to authenticated;
