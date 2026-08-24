-- ═══════════════════════════════════════════════════════════════════════════
-- Discarding a draft goes through the same door as every document write.
--
-- 20260711000001 revoked table-level UPDATE on documents to close the
-- forged-invoice hole, on the claim that "INSERT/SELECT/DELETE are untouched".
-- True for psql — false for PostgREST: its DELETE plan locks the doomed rows
-- with SELECT … FOR UPDATE first, and FOR UPDATE needs the UPDATE privilege.
-- So the moment that migration landed, every Discard — tablet and web — died
-- with "permission denied for table documents (GRANT UPDATE …)".
--
-- Every other document mutation already runs through a SECURITY DEFINER RPC;
-- discard joins them. Same guards as the doc_delete policy it replaces
-- (own tenant, status = 'draft', owner/manager/cashier), lines removed
-- explicitly, and an audit row — a quote disappearing should say who
-- dismissed it.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.discard_draft(p_document_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_doc    public.documents;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_doc from public.documents
   where id = p_document_id and tenant_id = v_tenant for update;
  if not found then raise exception 'document not found'; end if;
  if v_doc.status <> 'draft' then raise exception 'only a draft can be discarded'; end if;

  -- Lines first, then the header. Anything already raised FROM this draft (a
  -- revision, a job, a bill) still points at it and fails on its foreign key —
  -- the clients turn that into "another document refers back to it".
  delete from public.document_lines where document_id = v_doc.id;
  delete from public.documents where id = v_doc.id;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'draft_discarded', 'document', v_doc.id,
          jsonb_build_object('doc_type', v_doc.doc_type, 'total_incl', v_doc.total_incl));
end $$;

revoke execute on function public.discard_draft(uuid) from public;
grant  execute on function public.discard_draft(uuid) to authenticated;
