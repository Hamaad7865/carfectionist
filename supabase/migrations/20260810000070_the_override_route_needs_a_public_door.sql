-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — the override route needs a public door.
--
-- app.record_owner_override (20260810000030) is deliberately service-role-only
-- — it decides who the owner is, so it must never be reachable from a browser
-- or tablet session. But PostgREST on this project only exposes the `public`
-- and `graphql_public` schemas — `app` is not one of them. Checked directly
-- against the hosted project: admin.schema('app').rpc('record_owner_override',
-- ...) comes back PGRST106 "Invalid schema: app / Only the following schemas
-- are exposed: public, graphql_public". So even the service-role web route
-- (apps/web/src/app/api/override) cannot reach an app-schema function over the
-- REST API supabase-js uses — the client library supports .schema('app'), the
-- server it talks to does not expose it.
--
-- This is a pass-through, not a second implementation: same signature, same
-- grants — service_role only, revoked from public AND authenticated, exactly
-- like the function it wraps — so the PIN/role/reason decision stays in the
-- one place that makes it. Do not weaken these grants; do not duplicate the
-- verify_staff_pin / role / reason logic here.
--
-- ANON, TOO. The `public` schema carries a default ACL from project setup
-- (pg_default_acl: role postgres, schema public, objtype 'f') that auto-grants
-- EXECUTE to postgres, anon, authenticated AND service_role on every function
-- created there — `app` carries no such rule, which is why the function this
-- wraps never had the problem. Revoking from "public" (the pseudo-role) does
-- NOT touch that separate, explicit anon grant; it has to be revoked by name,
-- or this "service-role-only" door is callable by anyone holding the anon key,
-- no session and no PIN-route gate required. (Checked live: verify_staff_pin,
-- set_staff_pin and clear_staff_pin all still carry an unrevoked anon grant
-- today for exactly this reason — pre-existing, out of scope here, flagged
-- separately.)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.record_owner_override(
  p_app_user_id uuid,
  p_pin         text,
  p_kind        text,
  p_ref_type    text,
  p_ref_id      uuid,
  p_reason      text,
  p_scope       jsonb default '{}'::jsonb
) returns public.owner_overrides
language sql security definer set search_path = public, pg_temp as $$
  select * from app.record_owner_override(p_app_user_id, p_pin, p_kind, p_ref_type, p_ref_id, p_reason, p_scope);
$$;

comment on function public.record_owner_override(uuid, text, text, text, uuid, text, jsonb) is
  'PostgREST-reachable door onto app.record_owner_override (app is not an exposed schema on this project). Pure pass-through — the PIN/role/reason logic lives only in the app-schema function.';

revoke execute on function public.record_owner_override(uuid, text, text, text, uuid, text, jsonb) from public;
revoke execute on function public.record_owner_override(uuid, text, text, text, uuid, text, jsonb) from authenticated;
revoke execute on function public.record_owner_override(uuid, text, text, text, uuid, text, jsonb) from anon;
grant  execute on function public.record_owner_override(uuid, text, text, text, uuid, text, jsonb) to service_role;

-- ── prove the door is actually locked, not just labelled so ────────────────
-- A grant/revoke typo here is invisible in the SQL text — it only shows up as
-- a live ACL row. Fail the migration if anyone but service_role (and the
-- owning role) can still call it.
do $$
declare v_extra text;
begin
  select string_agg(distinct grantee, ', ') into v_extra
    from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'record_owner_override'
     and privilege_type = 'EXECUTE'
     and grantee not in ('service_role', 'postgres');
  if v_extra is not null then
    raise exception 'public.record_owner_override is EXECUTE-able by %, not just service_role', v_extra;
  end if;
end $$;
