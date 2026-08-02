-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a PIN's device verifier travels to the tills.
--
-- Offline sign-in (tablet ca8f948) admits an operator by checking a PBKDF2
-- verifier held on the device. Minted only locally, a verifier existed on a
-- given tablet only after that person's first ONLINE sign-in on that same
-- tablet — so a fresh tablet, or a cashier who had only ever used the other
-- till, was still locked out during an outage.
--
-- The server can hold ONE verifier per operator and hand it to every till via
-- the device-key-gated roster. It is minted at the two moments the plaintext
-- PIN legitimately passes through server-side code:
--   · set_staff_pin           — the owner types a PIN in Team settings (the
--                               web server action derives it and passes it in;
--                               pgcrypto has no PBKDF2, so it cannot be
--                               derived here)
--   · pos-auth pin-login      — a successful online sign-in (the edge
--                               function backfills/refreshes it)
--
-- The verifier is PBKDF2-HMAC-SHA256, 310k iterations — deliberately NOT the
-- bcrypt pin_hash, and deliberately much slower to guess. pin_hash never
-- leaves the server, exactly as before.
--
-- A PIN set WITHOUT a verifier (legacy caller, raw SQL) clears the stored
-- one: a verifier minted from the OLD pin must never keep unlocking tablets.
-- ═══════════════════════════════════════════════════════════════════════════

alter table app_users add column if not exists pin_device_verifier text;

-- ── set_staff_pin grows a verifier argument ─────────────────────────────────
-- One function, defaulted third arg — an overload would make PostgREST's
-- named-argument dispatch ambiguous for the existing two-argument callers.
drop function if exists public.set_staff_pin(uuid, text);

create or replace function public.set_staff_pin(
  p_app_user_id uuid,
  p_pin text,
  p_device_verifier text default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner');
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be exactly 4 digits'; end if;
  if p_device_verifier is not null and p_device_verifier !~ '^pbkdf2:sha256:[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$' then
    raise exception 'malformed device verifier';
  end if;
  update app_users
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
         -- No verifier supplied means the caller couldn't derive one — the old
         -- verifier is for the old PIN and must die with it.
         pin_device_verifier = p_device_verifier,
         pin_set_at = now(),
         pin_attempts = 0,
         pin_locked_until = null
   where id = p_app_user_id and tenant_id = v_tenant;
  if not found then raise exception 'staff member not found in this tenant'; end if;
end $$;
revoke execute on function public.set_staff_pin(uuid, text, text) from public;
grant  execute on function public.set_staff_pin(uuid, text, text) to authenticated;

-- ── clearing a PIN clears its verifier ──────────────────────────────────────
create or replace function public.clear_staff_pin(p_app_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner');
  update app_users
     set pin_hash = null, pin_device_verifier = null,
         pin_set_at = null, pin_attempts = 0, pin_locked_until = null
   where id = p_app_user_id and tenant_id = v_tenant;
end $$;

-- ── prove the shape ─────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'app_users' and column_name = 'pin_device_verifier'
  ) then raise exception 'pin_device_verifier column missing'; end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_staff_pin' and p.pronargs = 2
  ) then raise exception 'two-argument set_staff_pin still exists — PostgREST dispatch would be ambiguous'; end if;
end $$;
