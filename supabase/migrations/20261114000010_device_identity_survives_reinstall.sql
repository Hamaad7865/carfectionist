-- ═══════════════════════════════════════════════════════════════════════════
-- One tablet = one device, even when its app data is wiped.
--
-- 2026-11-14: the NEOSTRA till (TAB-84A1) lost its app storage overnight. Its device
-- code lived only there, so on launch it minted a new one — two, in fact (TAB-BDAD and
-- TAB-36FA, 8 s apart: two callers raced the empty store). The owner saw two "new
-- tablets" nobody bought, and the till's Cash Flow / Traceability split across three
-- codes: everything up to 13 Nov on TAB-84A1, today on TAB-36FA.
--
-- The fix, server side (the app gets a stable code + a hardware fingerprint too):
--   • devices.hardware_id — a SHA-256 of the tablet's Android ID, sent on register.
--     It survives an uninstall / "clear storage" (it only changes on factory reset).
--   • devices.merged_into — an earlier code of the same tablet points at the row in
--     use now. Pages follow the whole group, so history never splits again.
--   • register_device: a NEW code arriving with a known hardware_id is linked to the
--     existing tablet automatically — it inherits the name, the quotation-only flag
--     and the place in the "Appareil N" ordering (first_seen), and the old row retires.
--   • link_device / unlink_device: the owner's manual version, for tablets on an older
--     app that sends no fingerprint (today's three codes are linked with it).
-- Additive only: no cash_sessions / payments / audit rows are rewritten — device_id on
-- those stays the code that really rang the sale.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.devices
  add column if not exists hardware_id text,
  add column if not exists merged_into uuid references public.devices(id);

comment on column public.devices.hardware_id is
  'SHA-256 of the tablet''s Android ID. Survives reinstall / cleared app data; used to recognise the same tablet under a new code.';
comment on column public.devices.merged_into is
  'Set on an EARLIER code of a tablet: the device row in use now. Always points at a row whose own merged_into is null (chains are flattened on link).';

create index if not exists devices_hardware_id_idx
  on public.devices (tenant_id, hardware_id) where hardware_id is not null;
create index if not exists devices_merged_into_idx
  on public.devices (merged_into) where merged_into is not null;

-- ─── app.link_device — the one place a code becomes an alias ────────────────
-- p_inherit = true (automatic re-registration): the new row is a blank fresh
-- registration, so it takes the old row's name and quotation-only flag.
-- p_inherit = false (owner linking by hand from the current device's page): that
-- device's own settings win; the old name only fills a blank.
create or replace function app.link_device(p_old uuid, p_new uuid, p_inherit boolean, p_actor uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.devices;
  n public.devices;
begin
  if p_old = p_new then raise exception 'a device cannot be linked to itself'; end if;
  -- Lock both rows in a stable order so two concurrent links cannot deadlock.
  perform 1 from public.devices where id in (p_old, p_new) order by id for update;
  select * into o from public.devices where id = p_old;
  select * into n from public.devices where id = p_new;
  if o.id is null or n.id is null then raise exception 'device not found'; end if;
  if o.tenant_id <> n.tenant_id then raise exception 'device not found'; end if;
  if n.merged_into is not null then
    raise exception '% is itself an earlier code of another device — link to that device instead', n.device_code;
  end if;

  -- Flatten: whatever was already an earlier code of the old row now points at the new one.
  update public.devices set merged_into = n.id where merged_into = o.id;
  update public.devices set merged_into = n.id, is_active = false where id = o.id;
  update public.devices
     set first_seen     = least(n.first_seen, o.first_seen),  -- keeps its "Appareil N" place
         display_name   = case when p_inherit then coalesce(o.display_name, n.display_name)
                               else coalesce(n.display_name, o.display_name) end,
         takes_payments = case when p_inherit then o.takes_payments else n.takes_payments end,
         hardware_id    = coalesce(n.hardware_id, o.hardware_id)
   where id = n.id;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload, device_id)
  values (n.tenant_id, p_actor, 'device_linked', 'device', n.id,
          jsonb_build_object('from_code', o.device_code, 'to_code', n.device_code, 'reason', p_reason),
          n.device_code);
end $$;
revoke all on function app.link_device(uuid, uuid, boolean, uuid, text) from public;
revoke all on function app.link_device(uuid, uuid, boolean, uuid, text) from anon;
revoke all on function app.link_device(uuid, uuid, boolean, uuid, text) from authenticated;

-- ─── register_device — now takes the hardware fingerprint ───────────────────
-- Signature changes (a 5th arg), so the 4-arg version is DROPPED first: create or
-- replace would ADD an overload and leave the old body live. Older APKs call with the
-- four named args and resolve to this one through the default.
drop function if exists public.register_device(text, text, text, boolean);

create or replace function public.register_device(
  p_code text,
  p_model text default null,
  p_version text default null,
  p_heartbeat boolean default false,
  p_hardware_id text default null
) returns public.devices language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_hw     text := nullif(trim(coalesce(p_hardware_id, '')), '');
  v_dev    public.devices;
  v_prev   uuid;
  v_prev_version text;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  if coalesce(trim(p_code),'') = '' then raise exception 'device code is required'; end if;
  if length(p_code) > 64 then raise exception 'device code too long'; end if;
  if v_hw is not null and length(v_hw) > 128 then raise exception 'hardware id too long'; end if;

  select * into v_dev from public.devices
   where tenant_id = v_tenant and device_code = p_code for update;

  if not found then
    insert into public.devices (tenant_id, device_code, model, app_version, hardware_id)
    values (v_tenant, p_code, p_model, p_version, v_hw)
    returning * into v_dev;
    if not p_heartbeat then
      insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload, device_id)
      values (v_tenant, v_actor, 'terminal_started', 'device', v_dev.id,
              jsonb_build_object('device_code', p_code, 'model', p_model, 'app_version', p_version, 'first_registration', true),
              p_code);
    end if;
    -- Same tablet, new code (its app data was wiped): continue the existing device.
    if v_hw is not null then
      select id into v_prev from public.devices
       where tenant_id = v_tenant and hardware_id = v_hw and id <> v_dev.id and merged_into is null
       order by last_seen desc limit 1;
      if v_prev is not null then
        perform app.link_device(v_prev, v_dev.id, true, v_actor, 'same tablet registered under a new code');
        select * into v_dev from public.devices where id = v_dev.id;
      end if;
    end if;
    return v_dev;
  end if;

  v_prev_version := v_dev.app_version;
  update public.devices
     set last_seen   = now(),
         model       = coalesce(p_model, model),
         app_version = coalesce(p_version, app_version),
         hardware_id = coalesce(hardware_id, v_hw)  -- first report from an updated app
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
revoke all on function public.register_device(text, text, text, boolean, text) from public;
revoke all on function public.register_device(text, text, text, boolean, text) from anon;
grant execute on function public.register_device(text, text, text, boolean, text) to authenticated;

-- ─── link_device / unlink_device (owner/manager, device Settings tab) ───────
create or replace function public.link_device(p_old_device_id uuid, p_device_id uuid)
returns public.devices language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_dev    public.devices;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');
  if not exists (select 1 from public.devices where id = p_old_device_id and tenant_id = v_tenant)
     or not exists (select 1 from public.devices where id = p_device_id and tenant_id = v_tenant) then
    raise exception 'device not found';
  end if;
  perform app.link_device(p_old_device_id, p_device_id, false, app.current_app_user_id(), 'linked by hand');
  select * into v_dev from public.devices where id = p_device_id;
  return v_dev;
end $$;
revoke all on function public.link_device(uuid, uuid) from public;
revoke all on function public.link_device(uuid, uuid) from anon;
grant execute on function public.link_device(uuid, uuid) to authenticated;

-- Undo a wrong link: the code becomes its own device again (inactive — reactivate it
-- from its page if it really is a separate, working tablet).
create or replace function public.unlink_device(p_device_id uuid)
returns public.devices language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_dev    public.devices;
  v_into   public.devices;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');
  select * into v_dev from public.devices where id = p_device_id and tenant_id = v_tenant for update;
  if not found then raise exception 'device not found'; end if;
  if v_dev.merged_into is null then raise exception '% is not linked to another device', v_dev.device_code; end if;
  select * into v_into from public.devices where id = v_dev.merged_into;
  update public.devices set merged_into = null where id = v_dev.id returning * into v_dev;
  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload, device_id)
  values (v_tenant, app.current_app_user_id(), 'device_unlinked', 'device', v_into.id,
          jsonb_build_object('from_code', v_dev.device_code, 'to_code', v_into.device_code),
          v_into.device_code);
  return v_dev;
end $$;
revoke all on function public.unlink_device(uuid) from public;
revoke all on function public.unlink_device(uuid) from anon;
grant execute on function public.unlink_device(uuid) to authenticated;

notify pgrst, 'reload schema';
