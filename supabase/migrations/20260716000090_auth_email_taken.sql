-- ═══════════════════════════════════════════════════════════════════════════
-- "Is this login email already in use?" — asked BEFORE we try to set it.
--
-- The owner can now change a staff member's login email. When the new address
-- already belongs to another account, GoTrue's admin API does not say so: it
-- returns an AuthRetryableFetchError with status 500 and the message string
-- "{}" — no code, no text, nothing to match on. (Verified against this project:
-- scripts/_verify-staff-identity.mjs.) Matching on the message the way
-- createStaffAction does would therefore show the owner a literal "{}".
--
-- So the collision is detected up front instead. auth.users is not reachable
-- through PostgREST, and the admin API's listUsers is paginated (the roster
-- query already caps at 200 and silently drops the rest) — neither is a
-- trustworthy way to ask an exact question. This is.
--
-- It returns a boolean and nothing else: no address, no id, no user. Owner-only,
-- because only an owner can act on the answer.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.auth_email_taken(p_email text, p_exclude uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if app.current_user_role() is distinct from 'owner' then
    raise exception 'Only an owner can check staff logins';
  end if;
  return exists (
    select 1 from auth.users u
    where lower(u.email) = lower(trim(p_email))
      and (p_exclude is null or u.id <> p_exclude)
  );
end $$;

revoke execute on function public.auth_email_taken(text, uuid) from public, anon;
grant  execute on function public.auth_email_taken(text, uuid) to authenticated;
