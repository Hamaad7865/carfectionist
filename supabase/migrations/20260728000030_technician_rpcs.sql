-- ═══════════════════════════════════════════════════════════════════════════
-- Adding a technician from the tablet failed with
--   "new row violates row-level security policy for table app_users"
--
-- app_users has no INSERT policy at all, and its UPDATE policy is OWNER-only —
-- so a manager could neither add a technician nor retire one. Rather than open
-- the table up (it holds roles and PIN hashes, and a client that can write it
-- can escalate its own role), these go through SECURITY DEFINER RPCs that
-- enforce the rule themselves — the same shape as rename_device/set_device_active.
--
-- Scoped deliberately to TECHNICIANS: nothing here can create an owner, change
-- anyone's role, or retire an account that can sign in. The worst it can do is
-- add or hide a name that jobs are assigned to.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.add_technician(p_name text)
returns public.app_users language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_row    public.app_users;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');
  if coalesce(btrim(p_name),'') = '' then raise exception 'a technician needs a name'; end if;
  if length(p_name) > 80 then raise exception 'that name is too long'; end if;

  -- auth_user_id stays NULL: a detailer who never signs in is a staff RECORD,
  -- assignable to jobs, with no account and no way to log in.
  insert into public.app_users (tenant_id, auth_user_id, role, display_name, is_active)
  values (v_tenant, null, 'technician', btrim(p_name), true)
  returning * into v_row;

  return v_row;
end $$;
revoke execute on function public.add_technician(text) from public;
grant  execute on function public.add_technician(text) to authenticated;

/*
 * Retire or restore a TECHNICIAN. Never a delete: jobs reference them and must keep
 * reading. Refuses anyone who can sign in, so this can never lock a person out of
 * the POS, and refuses any role other than technician.
 */
create or replace function public.set_technician_active(p_id uuid, p_active boolean)
returns public.app_users language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_row    public.app_users;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

  select * into v_row from public.app_users
   where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'staff member not found'; end if;
  if v_row.role <> 'technician' then raise exception 'only technicians can be retired here'; end if;
  if v_row.auth_user_id is not null then raise exception 'that person has a login — change it in the back office'; end if;

  update public.app_users set is_active = p_active where id = p_id returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.set_technician_active(uuid, boolean) from public;
grant  execute on function public.set_technician_active(uuid, boolean) to authenticated;

/* Fix a typo in a technician's name. Same guards as above. */
create or replace function public.rename_technician(p_id uuid, p_name text)
returns public.app_users language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_row    public.app_users;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');
  if coalesce(btrim(p_name),'') = '' then raise exception 'a technician needs a name'; end if;

  select * into v_row from public.app_users where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'staff member not found'; end if;
  if v_row.role <> 'technician' then raise exception 'only technicians can be renamed here'; end if;
  if v_row.auth_user_id is not null then raise exception 'that person has a login — change it in the back office'; end if;

  update public.app_users set display_name = btrim(p_name) where id = p_id returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.rename_technician(uuid, text) from public;
grant  execute on function public.rename_technician(uuid, text) to authenticated;
