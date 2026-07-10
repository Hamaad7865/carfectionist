-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — accept a quote → job, atomically
-- The POS "Accept → create job" flow was two half-steps: create_job spun up a
-- fresh job while the source quote stayed 'draft' and unlinked — so the same
-- draft could be accepted again and again (duplicate jobs) and quotes never left
-- draft. There was no convert_quote_to_job (only convert_quote_to_invoice, 0003).
--
-- convert_quote_to_job does it in ONE transaction: issue+accept the quote (reuse
-- issue_document so we never re-derive the gapless-number / fiscal-snapshot seam),
-- create the job from the quote's customer+vehicle (mirroring create_job's
-- insert), and link them both ways — jobs.source_quote_id → the quote,
-- documents.job_id → the job. A unique index on jobs.source_quote_id makes it
-- idempotent: a second call hands back the job already made. SECURITY DEFINER,
-- tenant-resolved internally (mirrors the guard conventions in 0003/0010).
-- Additive only.
--
-- (Ported from branch claude/sharp-merkle-c65b36, renumbered from 0014, with
-- issue_document called at its real 3-arg signature — location null: quotes
-- never consume stock — under a deterministic per-quote idempotency key.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Provenance: the job a quote produced (one live job per quote) ───────────
alter table public.jobs add column if not exists source_quote_id uuid references public.documents(id);
create unique index if not exists idx_jobs_source_quote
  on public.jobs(source_quote_id) where source_quote_id is not null;

-- ─── convert_quote_to_job — issue+accept the quote, spawn the linked job ──────
create or replace function public.convert_quote_to_job(
  p_quote_id uuid,
  p_technician_id uuid,
  p_scheduled_at timestamptz default null
) returns public.jobs language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_q      public.documents;
  v_job    public.jobs;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  -- Lock the quote for the length of the txn so a double-tap serialises: the
  -- second caller blocks here, then falls into the idempotent return below.
  select * into v_q from public.documents
   where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;

  -- Idempotent: this quote was already converted — hand back the same job.
  select * into v_job from public.jobs
   where source_quote_id = v_q.id and tenant_id = v_tenant;
  if found then return v_job; end if;

  -- A job needs a real customer + vehicle (both NOT NULL on jobs). Surface the
  -- reason plainly — the POS drops its own vehicle-less guard and shows this.
  if v_q.customer_id is null then raise exception 'this quote has no customer — add one before starting a job'; end if;
  if v_q.vehicle_id  is null then raise exception 'this quote has no vehicle — add one before starting a job'; end if;
  if p_technician_id is not null and not exists (
    select 1 from public.app_users where id = p_technician_id and tenant_id = v_tenant
  ) then raise exception 'unknown technician'; end if;

  -- Accepting a quote makes it a real numbered document. Reuse issue_document for
  -- the gapless number + fiscal snapshot (drafts only — an already-issued quote
  -- keeps its number), then flip issued → accepted. Quotes aren't frozen by the
  -- fiscal lock, so the status/job_id update below is allowed.
  if v_q.status = 'draft' then
    select * into v_q from public.issue_document(v_q.id, null, 'quote-accept:' || v_q.id);
  elsif v_q.status <> 'issued' then
    raise exception 'this quote is % and cannot be converted to a job', v_q.status;
  end if;

  -- The job, straight from the quote's customer + vehicle (mirrors create_job).
  insert into public.jobs
    (tenant_id, customer_id, vehicle_id, technician_id, scheduled_at, notes,
     status, checklist, source_quote_id, created_by)
  values
    (v_tenant, v_q.customer_id, v_q.vehicle_id, p_technician_id, p_scheduled_at,
     'From quote ' || v_q.number, 'scheduled', '[]'::jsonb, v_q.id, v_actor)
  returning * into v_job;

  -- Link back + mark accepted, with an audit crumb for the conversion.
  update public.documents set status = 'accepted', job_id = v_job.id where id = v_q.id;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'quote_converted_to_job', 'document', v_q.id,
          jsonb_build_object('job_id', v_job.id, 'quote_number', v_q.number));

  return v_job;
end $$;

revoke execute on function public.convert_quote_to_job(uuid, uuid, timestamptz) from public;
grant  execute on function public.convert_quote_to_job(uuid, uuid, timestamptz) to authenticated;
