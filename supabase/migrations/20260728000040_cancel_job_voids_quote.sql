-- Cancelling a job now VOIDS the quote that produced it.
--
-- A cancelled job's quote stayed 'accepted', so it still read as live work in the quotes
-- list. Done inside cancel_job — which already resolves the bill and already knows
-- source_quote_id — so the web and the tablet behave identically.
--
-- Regenerated from the live definition with only the block below added; nothing else changed.

CREATE OR REPLACE FUNCTION public.cancel_job(p_job_id uuid, p_reason text, p_restock boolean DEFAULT true, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_job    public.jobs;
  v_inv    public.documents;
  v_money  text := 'no invoice';
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  -- Same gate as app.jobs_guard's cancelled transition.
  perform app.require_role('owner','manager');
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'a reason is required to cancel a job';
  end if;

  select * into v_job from public.jobs
   where id = p_job_id and tenant_id = v_tenant for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status = 'cancelled' then return v_job; end if; -- double tap: no-op
  if v_job.status not in ('scheduled','in_progress') then
    raise exception 'a % job cannot be cancelled — finish or deliver it instead', v_job.status;
  end if;

  -- The job's one live invoice, resolved so no bill is left pointing at dead work:
  -- a draft simply goes; an unpaid bill is voided; money already taken comes back
  -- as a credit note whose refund is BOOKED to the till (20260716000050).
  select * into v_inv from public.documents
   where tenant_id = v_tenant and job_id = p_job_id
     and doc_type = 'invoice' and status <> 'void'
   for update;
  if found then
    if v_inv.status = 'draft' then
      delete from public.document_lines where document_id = v_inv.id;
      delete from public.documents where id = v_inv.id;
      v_money := 'draft deleted';
    elsif v_inv.amount_paid = 0 then
      perform public.void_document(v_inv.id, 'Job cancelled — ' || trim(p_reason));
      v_money := 'bill ' || coalesce(v_inv.number, '?') || ' voided';
    else
      perform public.create_and_issue_credit_note(v_inv.id, null, p_restock, p_session_id);
      v_money := 'bill ' || coalesce(v_inv.number, '?') || ' credit-noted, ' || v_inv.amount_paid || ' refunded';
    end if;
  end if;

  update public.jobs set status = 'cancelled', cancelled_at = now(), cancel_reason = trim(p_reason) where id = p_job_id returning * into v_job;

  -- The quote that produced this job is dead work once the job is cancelled. Voiding it here
  -- rather than in the app means the web and the tablet agree, and the quotes list stops
  -- offering it as live. Quotes are not fiscal documents, so this is a status change, not a
  -- rewrite of anything a customer was billed.
  if v_job.source_quote_id is not null then
    update public.documents
       set status = 'void', voided_at = now(), void_reason = 'Job cancelled — ' || trim(p_reason)
     where id = v_job.source_quote_id and doc_type = 'quote' and status <> 'void';
  end if;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'job_cancelled', 'job', p_job_id,
          jsonb_build_object('reason', trim(p_reason), 'money', v_money,
                             'quote', (select number from public.documents where id = v_job.source_quote_id)));
  return v_job;
end $function$
;
