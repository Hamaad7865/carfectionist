-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration: staff PINs (Android "tap name + 4-digit PIN" login)
-- Each app_user gets a bcrypt-hashed 4-digit PIN. The tablet never sees the
-- hash or the service-role key: it calls two Next.js routes (roster + pin-login)
-- that use the service role server-side. verify_staff_pin does the crypt check
-- and a per-user lockout (a 4-digit PIN is brute-forceable). Web login is
-- unchanged (email + password). Attribution stays correct-by-construction — the
-- tablet ends up holding the operator's real Supabase session.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

alter table app_users
  add column if not exists pin_hash        text,
  add column if not exists pin_set_at      timestamptz,
  add column if not exists pin_attempts    int not null default 0,
  add column if not exists pin_locked_until timestamptz;

-- ─── set_staff_pin (owner-only) ──────────────────────────────────────────────
-- Sets/replaces a staff member's 4-digit PIN. Called from the owner Team UI.
create or replace function public.set_staff_pin(p_app_user_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner');
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be exactly 4 digits'; end if;
  update app_users
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
         pin_set_at = now(),
         pin_attempts = 0,
         pin_locked_until = null
   where id = p_app_user_id and tenant_id = v_tenant;
  if not found then raise exception 'staff member not found in this tenant'; end if;
end $$;
revoke execute on function public.set_staff_pin(uuid, text) from public;
grant  execute on function public.set_staff_pin(uuid, text) to authenticated;

-- ─── clear_staff_pin (owner-only) ────────────────────────────────────────────
create or replace function public.clear_staff_pin(p_app_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner');
  update app_users set pin_hash = null, pin_set_at = null, pin_attempts = 0, pin_locked_until = null
   where id = p_app_user_id and tenant_id = v_tenant;
end $$;
revoke execute on function public.clear_staff_pin(uuid) from public;
grant  execute on function public.clear_staff_pin(uuid) to authenticated;

-- ─── verify_staff_pin (service-role only) ────────────────────────────────────
-- Called by the /api/pos/pin-login route via the service-role client. Not
-- exposed to authenticated users (they must not be able to brute-force PINs
-- through the DB). Locks a user for 5 minutes after 5 consecutive failures.
create or replace function public.verify_staff_pin(p_app_user_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row app_users;
begin
  select * into v_row from app_users where id = p_app_user_id for update;
  if not found or not v_row.is_active then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if v_row.pin_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'no_pin');
  end if;
  if v_row.pin_locked_until is not null and v_row.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_row.pin_locked_until);
  end if;

  if v_row.pin_hash = extensions.crypt(p_pin, v_row.pin_hash) then
    update app_users set pin_attempts = 0, pin_locked_until = null where id = p_app_user_id;
    return jsonb_build_object('ok', true, 'auth_user_id', v_row.auth_user_id,
                              'display_name', v_row.display_name, 'role', v_row.role);
  end if;

  -- wrong PIN: count up, lock after 5
  update app_users
     set pin_attempts = pin_attempts + 1,
         pin_locked_until = case when pin_attempts + 1 >= 5 then now() + interval '5 minutes' else pin_locked_until end
   where id = p_app_user_id;
  return jsonb_build_object('ok', false, 'reason', 'bad_pin');
end $$;
revoke execute on function public.verify_staff_pin(uuid, text) from public;
revoke execute on function public.verify_staff_pin(uuid, text) from authenticated;
grant  execute on function public.verify_staff_pin(uuid, text) to service_role;
