-- ═══════════════════════════════════════════════════════════════════════════
-- A ceramic-coating certificate could never be revoked: no status column, no
-- delete policy. A fully refunded coating job left its warranty certificate
-- looking exactly as live as one that is still owed — the customer could still
-- open /print/certificate/[id] and print proof of a warranty the shop no
-- longer honours.
--
-- Voided, not deleted: the certificate number was issued and handed to a
-- customer, so the record of it having existed must survive (same reasoning
-- as void_quote). void_certificate refuses to touch one that is already void.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.certificates add column if not exists voided_at   timestamptz;
alter table public.certificates add column if not exists void_reason text;

create or replace function public.void_certificate(p_certificate_id uuid, p_reason text default null)
returns public.certificates language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_cert   public.certificates;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

  select * into v_cert from public.certificates
   where id = p_certificate_id and tenant_id = v_tenant for update;
  if not found then raise exception 'certificate not found'; end if;
  if v_cert.voided_at is not null then raise exception 'this certificate is already void'; end if;

  update public.certificates
     set voided_at = now(),
         void_reason = nullif(btrim(p_reason), '')
   where id = v_cert.id
   returning * into v_cert;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'certificate_voided', 'certificate', v_cert.id,
          jsonb_build_object('reason', v_cert.void_reason, 'number', v_cert.number));

  return v_cert;
end $$;
revoke execute on function public.void_certificate(uuid, text) from public;
grant  execute on function public.void_certificate(uuid, text) to authenticated;
