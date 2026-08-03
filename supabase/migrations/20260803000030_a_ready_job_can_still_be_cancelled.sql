-- A job marked ready by mistake can now be cancelled.
--
-- Marking a car ready was a one-way door. The transition table allowed
--   scheduled   → in_progress, ready, cancelled
--   in_progress → ready, cancelled
--   ready       → delivered          ← the only exit
-- so a job put into 'ready' by a mis-tap could never be taken back, and cancel_job
-- refused it outright ('a ready job cannot be cancelled — finish or deliver it instead').
--
-- That left the counter with only one lever, and it doesn't work: voiding the bill.
-- A ready job with an accepted quote is auto-billed, and the tablet's "Go to checkout"
-- re-mints the invoice whenever it finds none live — deliberately, so that voiding a
-- bill can't permanently block re-billing. The bill therefore came straight back under
-- a new number. Vikram Budree's ALLION ran INV-0054 → 0061 → 0062 → 0064 that way,
-- three voids that all looked like they had failed.
--
-- Cancelling a ready job is the correction the owner was reaching for: the car is still
-- on the premises (delivered is the handover, and stays uncancellable), so there is
-- nothing to unwind but the paperwork — which cancel_job already resolves.
--
-- Both functions are regenerated from their live definitions with ONLY the 'ready'
-- transition added; nothing else changed.

-- 1) jobs_guard — allow ready → cancelled ------------------------------------
CREATE OR REPLACE FUNCTION app.jobs_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_role text := (app.current_user_role())::text;
begin
  -- No user context = service role / migrations / backfills: trusted.
  if auth.uid() is null then return new; end if;

  if new.tenant_id       is distinct from old.tenant_id
     or new.customer_id     is distinct from old.customer_id
     or new.vehicle_id      is distinct from old.vehicle_id
     or new.source_quote_id is distinct from old.source_quote_id
     or new.created_at      is distinct from old.created_at then
    raise exception 'job identity columns are immutable';
  end if;

  if new.status is distinct from old.status then
    -- 'ready' is work finished but NOT handed over — the car is still here, so the
    -- booking can still be called off. 'delivered' stays a one-way door: once the
    -- customer has driven away, the correction is a credit note, not a cancellation.
    if not ( (old.status = 'scheduled'   and new.status in ('in_progress','ready','cancelled'))
          or (old.status = 'in_progress' and new.status in ('ready','cancelled'))
          or (old.status = 'ready'       and new.status in ('delivered','cancelled'))
          or (old.status = 'delivered'   and new.status = 'ready') ) then
      raise exception 'illegal job transition: % -> %', old.status, new.status;
    end if;
    if new.status = 'delivered' and v_role not in ('owner','manager','cashier') then
      raise exception 'only owner, manager or cashier can mark a job delivered';
    end if;
    if new.status = 'cancelled' and v_role not in ('owner','manager') then
      raise exception 'only owner or manager can cancel a job';
    end if;
    if old.status = 'delivered' and new.status = 'ready' and v_role not in ('owner','manager')
       and coalesce(current_setting('app.allow_undeliver', true), '') <> '1' then
      raise exception 'only owner or manager can un-deliver a job';
    end if;
  end if;
  return new;
end $function$;

-- 2) cancel_job — accept a ready job ------------------------------------------
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
  -- 'ready' joins the list: the car has not left, so the booking can still be called
  -- off. Without it, a mis-tapped "Mark ready" trapped the job and its bill kept
  -- regenerating after every void (20260803000030).
  if v_job.status not in ('scheduled','in_progress','ready') then
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
end $function$;

grant execute on function public.cancel_job(uuid, text, boolean, uuid) to authenticated;
