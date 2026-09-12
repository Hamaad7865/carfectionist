-- Voiding and declining must see every live bill and every live job.
--
-- BUGHUNT M1/M6: both guards only matched invoices with
-- source_document_id = this quote and status <> 'void' — so a bill raised from
-- a live revision, or claimed by the job (job_id / junction), never blocked a
-- void or a decline, while a mere DRAFT (no number, no money) blocked with the
-- wrong remedy ("credit-note that invoice"). void_quote's job check read only
-- the quote's single job_id, missing the other cards of a multi-car line.
-- Drafts never block now; live bills in any of these shapes do.
CREATE OR REPLACE FUNCTION public.void_quote(p_quote_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Any live card on this quote's line, not just the one it names: multi-car
  -- quotes job every car, and only the first is stamped on the quote itself.
  -- Junction-linked cards count too.
  select j.status into v_job from public.jobs j
   where j.tenant_id = v_tenant and j.status not in ('cancelled', 'delivered')
     and (j.id = v_q.job_id
          or j.source_quote_id = v_q.id
          or exists (select 1 from public.document_jobs dj
                      where dj.document_id = v_q.id and dj.job_id = j.id))
   limit 1;
  if v_job is not null then
    raise exception 'this quote has a job that is % — cancel the job instead', v_job;
  end if;

  -- Any live bill touching this quote or its job: raised from it, claimed by
  -- the job, or riding the junction. Drafts are not bills and never block.
  select i.number into v_inv from public.documents i
   where i.tenant_id = v_tenant and i.doc_type = 'invoice' and i.status not in ('draft', 'void')
     and (i.source_document_id = v_q.id
          or (v_q.job_id is not null
              and (i.job_id = v_q.job_id
                   or exists (select 1 from public.document_jobs dj
                               where dj.document_id = i.id and dj.job_id = v_q.job_id))))
   limit 1;
  if v_inv is not null then
    raise exception 'this quote has been billed on % — credit-note that invoice instead', v_inv;
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
end $function$;

CREATE OR REPLACE FUNCTION public.decline_quote(p_quote_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_q      public.documents;
  v_inv    text;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents
   where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'that document is not a quote'; end if;
  if v_q.status = 'declined' then return v_q; end if;   -- idempotent: a second tap is not an error

  if v_q.status = 'draft' then
    raise exception 'this quotation was never sent — discard it instead of declining it';
  end if;
  if v_q.status <> 'issued' then
    raise exception 'this quotation is % — only one that has been sent and not yet agreed can be declined', v_q.status;
  end if;

  -- Same live-bill rule as void_quote: drafts never block.
  select i.number into v_inv from public.documents i
   where i.tenant_id = v_tenant and i.doc_type = 'invoice' and i.status not in ('draft', 'void')
     and (i.source_document_id = v_q.id
          or (v_q.job_id is not null
              and (i.job_id = v_q.job_id
                   or exists (select 1 from public.document_jobs dj
                               where dj.document_id = i.id and dj.job_id = v_q.job_id))))
   limit 1;
  if v_inv is not null then
    raise exception 'this quotation has already been billed on % — credit that invoice instead', v_inv;
  end if;

  update public.documents set
    status          = 'declined',
    declined_at     = now(),
    declined_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = v_q.id returning * into v_q;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'quote_declined', 'document', v_q.id,
          jsonb_build_object('number', v_q.number, 'reason', v_q.declined_reason));

  return v_q;
end $function$;
