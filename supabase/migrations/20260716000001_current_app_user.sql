-- One round trip for "who is this request?".
--
-- The server used to answer that in TWO sequential network calls: auth.getUser()
-- (asking Supabase Auth to validate the token) and then a select on app_users for
-- the tenant/role. At ~250ms a hop from the Worker, that was a ~500ms tax on every
-- page in the app, paid before any page could start rendering.
--
-- This collapses it to one. Security is unchanged, and specifically NOT weakened:
--   • PostgREST verifies the JWT's signature before this function ever runs — a
--     forged or expired token never reaches it, and auth.uid() is null without a
--     valid one, so the function returns no row (= not signed in).
--   • SECURITY DEFINER only exists to skip the RLS re-entrancy on app_users; the
--     WHERE clause is pinned to auth.uid(), so a caller can only ever read their
--     OWN row. It cannot be coaxed into returning anyone else's.
--   • is_active is still enforced — a disabled account resolves to nothing.
--
-- Token REFRESH is unaffected: it happens in the browser (see AuthKeepalive),
-- because Workers can't run Next's Node-only middleware. getUser() was never
-- refreshing anything server-side — it was pure latency.

create or replace function public.current_app_user()
returns table (
  user_id      uuid,
  tenant_id    uuid,
  role         user_role,
  display_name text,
  modules      text[]
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select au.auth_user_id, au.tenant_id, au.role, au.display_name, au.modules
  from public.app_users au
  where au.auth_user_id = auth.uid()
    and au.is_active
  limit 1
$$;

revoke execute on function public.current_app_user() from public, anon;
grant execute on function public.current_app_user() to authenticated;
