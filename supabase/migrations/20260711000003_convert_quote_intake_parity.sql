-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — one accept path: convert_quote_to_job carries the intake
-- The web's "Start job" used create_job_from_document (copies intake markers +
-- before-photos, starter checklist, service-title notes — but leaves the quote
-- an unnumbered draft), while the POS's accept used convert_quote_to_job
-- (issues + accepts + links the quote, idempotent — but dropped the intake).
-- This recreation makes convert_quote_to_job do both, so BOTH apps accept a
-- quote through it: damage markers + before-photos come out of the quote's
-- intake snapshot, the job gets the standard starter checklist, and it is named
-- after the quote's first line instead of "From quote X".
--
-- The POS's client-side stamping (markers/photos re-sent after accept from its
-- in-session intake handoff) stays safe: quotes created on the tablet carry no
-- intake jsonb (save_draft never writes it), so there is nothing to double-copy;
-- a web-created quote accepted on the tablet has no warm handoff, so only the
-- RPC copies. create_job_from_document remains for non-quote documents.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.convert_quote_to_job(
  p_quote_id uuid,
  p_technician_id uuid,
  p_scheduled_at timestamptz default null
) returns public.jobs language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_actor   uuid := app.current_app_user_id();
  v_q       public.documents;
  v_job     public.jobs;
  v_service text;
  r         jsonb;
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

  -- The job is named after the work quoted, not the paperwork it came from.
  select title into v_service from public.document_lines
   where document_id = v_q.id order by sort_order limit 1;

  insert into public.jobs
    (tenant_id, customer_id, vehicle_id, technician_id, scheduled_at, notes,
     status, checklist, damage_markers, source_quote_id, created_by)
  values
    (v_tenant, v_q.customer_id, v_q.vehicle_id, p_technician_id, p_scheduled_at,
     coalesce(nullif(btrim(v_service), ''), 'From quote ' || v_q.number), 'scheduled',
     '[{"label":"Intake photos & damage check","done":false},{"label":"Wash & prep","done":false},{"label":"Service work","done":false},{"label":"Final inspection","done":false}]'::jsonb,
     coalesce(v_q.intake->'markers', '[]'::jsonb),
     v_q.id, v_actor)
  returning * into v_job;

  -- Before-photos captured at intake → job_photos (files already in the bucket).
  -- Only runs on the create branch, so the idempotent replay can't duplicate them.
  for r in select value from jsonb_array_elements(coalesce(v_q.intake->'photos', '[]'::jsonb)) loop
    if nullif(r->>'path', '') is not null then
      insert into public.job_photos (tenant_id, job_id, storage_path, caption, phase, created_by)
      values (v_tenant, v_job.id, r->>'path', nullif(r->>'caption', ''), 'before', v_actor);
    end if;
  end loop;

  -- Link back + mark accepted, with an audit crumb for the conversion.
  update public.documents set status = 'accepted', job_id = v_job.id where id = v_q.id;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'quote_converted_to_job', 'document', v_q.id,
          jsonb_build_object('job_id', v_job.id, 'quote_number', v_q.number));

  return v_job;
end $$;

revoke execute on function public.convert_quote_to_job(uuid, uuid, timestamptz) from public;
grant  execute on function public.convert_quote_to_job(uuid, uuid, timestamptz) to authenticated;
