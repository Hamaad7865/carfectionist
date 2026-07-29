-- ═══════════════════════════════════════════════════════════════════════════
-- Void a quote the customer never came back for.
--
-- A draft is DELETED (doc_delete allows it, and a draft has no number to keep).
-- Once accepted, a quote carries a number and a signature, so it is voided rather
-- than erased: the record of what was agreed survives, it simply stops reading as
-- live work. void_document() refuses anything that is not an invoice, hence this.
--
-- Two guards, both about not hiding something real:
--   • a live JOB means the work is booked or under way — cancel the job instead,
--     which already voids its quote;
--   • a live INVOICE means the customer has been billed — that is a credit note's
--     job, not this.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.void_quote(p_quote_id uuid, p_reason text default null)
returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_q      public.documents;
  v_job    text;
  v_inv    text;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

  select * into v_q from public.documents
   where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'that document is not a quote'; end if;
  if v_q.status = 'void' then return v_q; end if;
  if v_q.status = 'draft' then raise exception 'discard drafts instead of voiding them'; end if;

  select j.status into v_job from public.jobs j
   where j.id = v_q.job_id and j.status not in ('cancelled', 'delivered');
  if v_job is not null then
    raise exception 'this quote has a job that is % — cancel the job instead', v_job;
  end if;

  select i.number into v_inv from public.documents i
   where i.source_document_id = v_q.id and i.doc_type = 'invoice' and i.status <> 'void'
   limit 1;
  if v_inv is not null then
    raise exception 'this quote has been billed on %  — credit-note that invoice instead', v_inv;
  end if;

  update public.documents
     set status = 'void', voided_at = now(),
         void_reason = coalesce(nullif(btrim(p_reason), ''), 'Customer did not come back')
   where id = v_q.id
   returning * into v_q;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'document_voided', 'document', v_q.id,
          jsonb_build_object('reason', v_q.void_reason, 'number', v_q.number, 'doc_type', 'quote'));

  return v_q;
end $$;
revoke execute on function public.void_quote(uuid, text) from public;
grant  execute on function public.void_quote(uuid, text) to authenticated;
