-- ═══════════════════════════════════════════════════════════════════════════
-- Critical-path guard fixes (intake → quote → accept → job → invoice).
-- A review found three reachable cross-path holes where two RPCs protect the
-- same invariant with DIFFERENT keys and never cross-check:
--
--  S1  DOUBLE INVOICE FOR ONE JOB. create_document_from_job makes an invoice
--      keyed on job_id (source_document_id NULL); convert_quote_to_invoice
--      guards on source_document_id only. So: accept quote→job, make the
--      invoice from the JobCard, then "Convert to invoice" on the quote → a
--      SECOND live invoice (two fiscal numbers, double billing). Fix: the
--      convert idempotency check now also matches an invoice on the quote's
--      job_id, so it hands that one back instead of minting a second.
--
--  S3  DEAD-QUOTE BILLING. convert_quote_to_invoice checked only doc_type, so a
--      declined / expired / void quote could still be turned into a billable
--      invoice. Fix: restrict to draft / issued / accepted.
--
--  S2  TWO JOBS FROM ONE QUOTE. create_job_from_document (web "Start job") set
--      documents.job_id but NOT jobs.source_quote_id, while convert_quote_to_job
--      (tablet accept) guards + unique-indexes on source_quote_id — so the two
--      job-creation paths couldn't see each other. Fix: create_job_from_document
--      now stamps source_quote_id for quote sources, so the unique index
--      idx_jobs_source_quote and both guards align.
--
-- All three are CREATE OR REPLACE with the invariant added; bodies otherwise
-- unchanged. SECURITY DEFINER + grants preserved.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── S1 + S3: convert_quote_to_invoice ──────────────────────────────────────
create or replace function public.convert_quote_to_invoice(p_quote_id uuid)
returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_q   public.documents;
  v_inv public.documents;
  v_new uuid := gen_random_uuid();
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;
  -- S3: a declined / expired / void quote is not billable.
  if v_q.status not in ('draft','issued','accepted') then
    raise exception 'cannot invoice a % quote', v_q.status;
  end if;

  -- Idempotent, and S1: return an existing live invoice whether it was raised
  -- from THIS quote (source_document_id) or from the quote's JOB (job_id) — the
  -- two paths that otherwise each mint their own invoice for the same sale.
  select * into v_inv from public.documents
   where doc_type = 'invoice' and tenant_id = v_tenant and status <> 'void'
     and ( source_document_id = v_q.id
           or (v_q.job_id is not null and job_id = v_q.job_id) )
   order by created_at
   limit 1;
  if found then return v_inv; end if;

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, discount_kind, discount_value, created_by)
  values
    (v_new, v_tenant, 'invoice', 'draft', v_q.customer_id, v_q.vehicle_id, v_q.job_id, v_q.id,
     v_q.template_id, v_q.template_overrides, v_q.currency, v_q.origin, v_q.discount_kind, v_q.discount_value, app.current_app_user_id())
  returning * into v_inv;

  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order)
  select v_tenant, v_new, product_id, title, description, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order
  from public.document_lines where document_id = v_q.id;

  update public.documents set status = 'accepted' where id = v_q.id and status = 'issued';
  select * into v_inv from public.documents where id = v_new;
  return v_inv;
end $$;

-- ─── S2: create_job_from_document stamps source_quote_id for quote sources ───
create or replace function public.create_job_from_document(p_document_id uuid)
returns public.jobs language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_actor   uuid := app.current_app_user_id();
  v_doc     public.documents;
  v_job     public.jobs;
  v_service text;
  r         jsonb;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_doc from public.documents where id = p_document_id and tenant_id = v_tenant for update;
  if not found then raise exception 'document not found'; end if;
  if v_doc.job_id is not null then raise exception 'this document already has a job'; end if;
  if v_doc.status = 'void' then raise exception 'cannot start a job from a void document'; end if;
  if v_doc.customer_id is null or v_doc.vehicle_id is null then raise exception 'the quote needs a customer and a vehicle first'; end if;

  select title into v_service from public.document_lines where document_id = v_doc.id order by sort_order limit 1;

  -- source_quote_id lets convert_quote_to_job's guard + idx_jobs_source_quote see
  -- a job that THIS path already created, so the same quote can't spawn a 2nd job.
  insert into public.jobs (tenant_id, customer_id, vehicle_id, source_quote_id, damage_markers, notes, status, checklist, created_by)
  values (v_tenant, v_doc.customer_id, v_doc.vehicle_id,
          case when v_doc.doc_type = 'quote' then v_doc.id else null end,
          coalesce(v_doc.intake->'markers', '[]'::jsonb), nullif(v_service, ''), 'scheduled',
          '[{"label":"Intake photos & damage check","done":false},{"label":"Wash & prep","done":false},{"label":"Service work","done":false},{"label":"Final inspection","done":false}]'::jsonb,
          v_actor)
  returning * into v_job;

  for r in select value from jsonb_array_elements(coalesce(v_doc.intake->'photos', '[]'::jsonb)) loop
    if nullif(r->>'path', '') is not null then
      insert into public.job_photos (tenant_id, job_id, storage_path, caption, phase, created_by)
      values (v_tenant, v_job.id, r->>'path', nullif(r->>'caption', ''), 'before', v_actor);
    end if;
  end loop;

  update public.documents set job_id = v_job.id where id = v_doc.id;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'job_from_document', 'job', v_job.id, jsonb_build_object('document_id', v_doc.id));

  return v_job;
end $$;
