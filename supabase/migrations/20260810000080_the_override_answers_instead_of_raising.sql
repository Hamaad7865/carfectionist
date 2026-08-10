-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a rejected override PIN is an ANSWER, not an exception.
--
-- 20260810000030 had app.record_owner_override RAISE on a bad PIN. That quietly
-- disarmed the very lockout it depended on: verify_staff_pin increments the
-- attempt counter, the raise aborts the transaction, and the increment goes with
-- it. Measured on the sandbox owner — wrong PIN through that path left
-- pin_attempts at 0, while the same wrong PIN through verify_staff_pin alone
-- left it at 1. A 4-digit secret whose lockout silently reverts is a
-- 10,000-guess dial, which would have undone rule 3 entirely.
--
-- So a rejected PIN now RETURNS {ok:false, reason, locked_until}. The counter
-- commits, and the caller gets a fact instead of a stack trace. A non-owner or
-- an unknown approver still raises: those are programming errors on the caller's
-- part, not something a person at the counter can do by mistyping.
--
-- The return type therefore changes from public.owner_overrides to jsonb, which
-- CREATE OR REPLACE cannot do — hence the drops. The public wrapper is dropped
-- first because it depends on the app function.
--
-- WHY THIS MIGRATION EXISTS AT ALL: this behaviour was already live. It was
-- applied straight to the database during the work and never written down, so
-- pg_get_functiondef and supabase/migrations disagreed — a fresh database would
-- have been built with the raising version and the lockout hole. That gap is how
-- today's earlier incident started (see 20260810000015). The body below was
-- CAPTURED from the live function, not retyped, so what is committed is exactly
-- what has been running.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.record_owner_override(uuid, text, text, text, uuid, text, jsonb);
drop function if exists app.record_owner_override(uuid, text, text, text, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION app.record_owner_override(p_app_user_id uuid, p_pin text, p_kind text, p_ref_type text, p_ref_id uuid, p_reason text, p_scope jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_check jsonb;
  v_user  public.app_users;
  v_row   public.owner_overrides;
begin
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'an override requires a reason';
  end if;

  select * into v_user from public.app_users where id = p_app_user_id;
  if not found or not v_user.is_active then raise exception 'unknown approver'; end if;
  if v_user.role <> 'owner' then raise exception 'only the owner can approve an override'; end if;

  -- The PIN is checked HERE. verify_staff_pin carries the per-user lockout that
  -- makes a 4-digit secret survivable.
  v_check := public.verify_staff_pin(p_app_user_id, p_pin);
  if not coalesce((v_check->>'ok')::boolean, false) then
    -- RETURN, do not raise. verify_staff_pin has just counted this guess
    -- against the account; raising here would roll that count back and hand
    -- the guesser a free attempt. See the header — this line is the fix.
    return jsonb_build_object(
      'ok', false,
      'reason', coalesce(v_check->>'reason', 'invalid'),
      'locked_until', v_check->'locked_until');
  end if;

  insert into public.owner_overrides (tenant_id, kind, ref_type, ref_id, scope, reason, approved_by)
  values (v_user.tenant_id, p_kind, p_ref_type, p_ref_id, coalesce(p_scope,'{}'::jsonb), trim(p_reason), p_app_user_id)
  returning * into v_row;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_user.tenant_id, p_app_user_id, 'owner_override', p_ref_type, p_ref_id,
          jsonb_build_object('kind', p_kind, 'reason', trim(p_reason), 'scope', p_scope));

  return jsonb_build_object('ok', true, 'override', to_jsonb(v_row));
end $function$
;

revoke execute on function app.record_owner_override(uuid, text, text, text, uuid, text, jsonb) from public;
revoke execute on function app.record_owner_override(uuid, text, text, text, uuid, text, jsonb) from authenticated;
revoke execute on function app.record_owner_override(uuid, text, text, text, uuid, text, jsonb) from anon;
grant  execute on function app.record_owner_override(uuid, text, text, text, uuid, text, jsonb) to service_role;

-- The PostgREST-reachable door: `app` is not an exposed schema on this project.
-- Pure pass-through — the PIN, role and reason logic lives only in the app function.
create or replace function public.record_owner_override(
  p_app_user_id uuid, p_pin text, p_kind text, p_ref_type text,
  p_ref_id uuid, p_reason text, p_scope jsonb default '{}'::jsonb
) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select app.record_owner_override(p_app_user_id, p_pin, p_kind, p_ref_type, p_ref_id, p_reason, p_scope);
$$;

-- `public` functions carry a default ACL that auto-grants EXECUTE to anon; the
-- `app` schema does not. Revoking the pseudo-role "public" does NOT remove that
-- separate named grant, so anon must be revoked BY NAME or the anon key reaches
-- this door directly, bypassing the route's session and tenant checks.
revoke execute on function public.record_owner_override(uuid, text, text, text, uuid, text, jsonb) from public;
revoke execute on function public.record_owner_override(uuid, text, text, text, uuid, text, jsonb) from authenticated;
revoke execute on function public.record_owner_override(uuid, text, text, text, uuid, text, jsonb) from anon;
grant  execute on function public.record_owner_override(uuid, text, text, text, uuid, text, jsonb) to service_role;

do $$
declare v_extra text;
begin
  select string_agg(grantee, ', ') into v_extra
    from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'record_owner_override'
     and grantee not in ('service_role', 'postgres');
  if v_extra is not null then
    raise exception 'public.record_owner_override is EXECUTE-able by %, not just service_role', v_extra;
  end if;
end $$;
