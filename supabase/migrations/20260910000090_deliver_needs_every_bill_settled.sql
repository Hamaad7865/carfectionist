-- Delivering needs EVERY live bill settled, not just the oldest row.
--
-- BUGHUNT M15: the lookup took the oldest non-void invoice — drafts included —
-- so a stale draft plus a paid bill raised "not settled (status draft)" about
-- the draft while the money sat paid. Now: any issued/partly-paid bill blocks
-- by name; delivery requires at least one paid bill and zero unsettled ones;
-- drafts alone get "issue it first" instead of a settlement lecture.
CREATE OR REPLACE FUNCTION public.deliver_paid_job(p_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_doc    public.documents;
  v_job    public.jobs;
  v_open   text;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  -- The job's live bills, found through the junction as well as job_id: on a
  -- bill covering three cars only the first is named by job_id.
  -- Any unsettled one blocks, named — delivering on a paid bill while another
  -- still owes would hand the car over with debt on it.
  select d.number into v_open from public.documents d
   where d.tenant_id = v_tenant and d.doc_type = 'invoice'
     and d.status in ('issued', 'partly_paid')
     and (d.job_id = p_job_id
          or exists (select 1 from public.document_jobs dj
                      where dj.document_id = d.id and dj.job_id = p_job_id))
   order by d.created_at
   limit 1;
  if found then
    raise exception 'bill % is not settled — collect at checkout', v_open;
  end if;

  select * into v_doc from public.documents d
   where d.tenant_id = v_tenant and d.doc_type = 'invoice' and d.status = 'paid'
     and (d.job_id = p_job_id
          or exists (select 1 from public.document_jobs dj
                      where dj.document_id = d.id and dj.job_id = p_job_id))
   order by d.created_at
   limit 1
   for update;
  if not found then
    if exists (select 1 from public.documents d
                where d.tenant_id = v_tenant and d.doc_type = 'invoice' and d.status = 'draft'
                  and (d.job_id = p_job_id
                       or exists (select 1 from public.document_jobs dj
                                   where dj.document_id = d.id and dj.job_id = p_job_id))) then
      raise exception 'the bill is still a draft — issue it at checkout first';
    end if;
    raise exception 'the job has no invoice — bill it first';
  end if;

  select * into v_job from public.jobs
   where id = p_job_id and tenant_id = v_tenant for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status = 'delivered' then return false; end if; -- double tap: no-op
  if v_job.status <> 'ready' then
    raise exception 'job is not ready for collection (status %)', v_job.status;
  end if;

  update public.jobs
     set status = 'delivered', delivered_at = now()
   where id = p_job_id;
  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'job_delivered', 'job', p_job_id,
          jsonb_build_object('invoice', v_doc.number, 'via', 'collected (paid earlier)'));
  return true;
end $function$;
