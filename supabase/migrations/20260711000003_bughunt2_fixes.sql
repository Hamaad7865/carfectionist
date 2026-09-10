-- ═══════════════════════════════════════════════════════════════════════════
-- Second bug-hunt fixes (SQL).
--   #1  vat_breakdown must ALWAYS come from the single authority
--       app.discounted_vat_groups() on issue — not just when an order-level
--       discount is present. Line-only discounts were already correct via the
--       generated columns, but relying on a discount-gated trigger left the
--       fiscal snapshot's provenance split across two code paths. Widen the
--       trigger so every issued document (invoice + credit note) snapshots the
--       authoritative per-rate figures. Collapses to the exact line sums when
--       there is no discount, so the canonical 77,200 / 11,580 / 88,780 vector
--       stays byte-identical.
--   #2  receive_transfer closed a transfer as 'received' even when p_lines was
--       empty or omitted dispatched lines — silently vaporising the dispatched
--       stock (a −qty went out at source, no +qty ever came in, and the closed
--       transfer can never be received again). Require every dispatched line to
--       be accounted for (an explicit 0 = genuine in-transit loss) and reject
--       foreign line ids, mirroring receive_purchase_order's guards.
--   #7  reverse_payment left a CLOSED cash session's stored expected_cash /
--       variance stale — the negative mirror carries the session id but the
--       figures were frozen at close. Recompute them so the till reconciliation
--       reflects the reversal.
-- ═══════════════════════════════════════════════════════════════════════════

-- #1 ── vat_breakdown from the single authority on every issue ────────────────
create or replace function app.snapshot_discounted_vat_breakdown() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'issued' and old.status is distinct from 'issued' then
    -- app.discounted_vat_groups is the SINGLE fiscal authority (same source as
    -- recompute_doc_totals). With no discount it returns the exact summed line
    -- columns, so undiscounted documents keep their byte-identical breakdown.
    new.vat_breakdown := (
      select jsonb_agg(jsonb_build_object('rate', rate, 'base', base, 'vat', vat) order by rate)
      from app.discounted_vat_groups(new.id)
    );
  end if;
  return new;
end $$;

-- #2 ── receive_transfer: every dispatched line must be accounted for ─────────
create or replace function public.receive_transfer(p_id uuid, p_lines jsonb)
returns public.stock_transfers language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_t public.stock_transfers;
  r record;
  v_line_count int;
  v_seen_count int;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');
  select * into v_t from public.stock_transfers where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'transfer not found'; end if;
  if v_t.status <> 'dispatched' then raise exception 'transfer is not in transit'; end if;

  -- Every dispatched line must appear in p_lines exactly once. Receiving less
  -- than dispatched is allowed (the gap is genuine in-transit loss), but it must
  -- be an explicit per-line acknowledgement — a missing/empty line would close
  -- the transfer and silently strand its dispatched stock.
  select count(*) into v_line_count
    from public.stock_transfer_lines where transfer_id = v_t.id and tenant_id = v_tenant;
  select count(*) into v_seen_count from (
    select distinct (e->>'line_id')::uuid lid
    from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) e
    where exists (
      select 1 from public.stock_transfer_lines l
      where l.id = (e->>'line_id')::uuid and l.transfer_id = v_t.id and l.tenant_id = v_tenant
    )
  ) s;
  if v_seen_count <> v_line_count then
    raise exception 'every dispatched line must be accounted for before the transfer can be received';
  end if;

  for r in select (e->>'line_id')::uuid as line_id, (e->>'qty_received')::numeric as qty
           from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) e loop
    -- Reject a line that is not on this transfer (a foreign id must not move stock).
    if not exists (
      select 1 from public.stock_transfer_lines l
      where l.id = r.line_id and l.transfer_id = v_t.id and l.tenant_id = v_tenant
    ) then raise exception 'line is not on this transfer'; end if;

    update public.stock_transfer_lines set qty_received = r.qty where id = r.line_id and transfer_id = v_t.id;
    insert into public.stock_movements (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, ref_line_id, created_by, note)
    select v_tenant, l.product_id, v_t.to_location_id, r.qty, p.cost_price, 'transfer', v_t.id, l.id, app.current_app_user_id(), 'transfer in'
    from public.stock_transfer_lines l join public.products p on p.id = l.product_id
    where l.id = r.line_id and l.transfer_id = v_t.id and l.tenant_id = v_tenant and r.qty > 0;
  end loop;

  update public.stock_transfers set status = 'received', received_at = now(), received_by = app.current_app_user_id()
  where id = p_id returning * into v_t;
  return v_t;
end $$;

-- #7 ── reverse_payment: refresh a closed cash session's reconciliation ───────
create or replace function public.reverse_payment(p_payment_id uuid, p_reason text default null)
returns public.payments language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_orig   public.payments;
  v_mirror public.payments;
  v_paid   numeric;
  v_doc    public.documents;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

  select * into v_orig from public.payments where id = p_payment_id and tenant_id = v_tenant for update;
  if not found then raise exception 'payment not found'; end if;
  if v_orig.amount < 0 then raise exception 'cannot reverse a reversal'; end if;
  if exists (
    select 1 from public.payments
    where reverses_payment_id = p_payment_id and tenant_id = v_tenant
  ) then
    raise exception 'payment already reversed';
  end if;

  insert into public.payments
    (tenant_id, document_id, method, amount, external_ref, reverses_payment_id, cash_session_id, received_by)
  values
    (v_tenant, v_orig.document_id, v_orig.method, -v_orig.amount,
     v_orig.external_ref, v_orig.id, v_orig.cash_session_id, v_actor)
  returning * into v_mirror;

  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = v_orig.document_id;
  select * into v_doc from public.documents where id = v_orig.document_id;
  update public.documents
     set amount_paid = v_paid,
         status = (case when v_paid >= v_doc.total_incl then 'paid'
                        when v_paid > 0 then 'partly_paid'
                        else 'issued' end)::doc_status
   where id = v_orig.document_id;

  -- If the reversed payment was tied to an already-closed cash session, its
  -- stored expected_cash/variance were frozen at close and no longer include the
  -- negative mirror. Recompute them exactly as close_cash_session would now.
  if v_orig.cash_session_id is not null then
    update public.cash_sessions cs set
      expected_cash = cs.opening_float + coalesce(
        (select sum(amount) from public.payments where cash_session_id = cs.id and method = 'cash'), 0),
      variance = cs.closing_count - (cs.opening_float + coalesce(
        (select sum(amount) from public.payments where cash_session_id = cs.id and method = 'cash'), 0))
    where cs.id = v_orig.cash_session_id and cs.tenant_id = v_tenant and cs.status = 'closed';
  end if;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'payment_reversed', 'payment', v_orig.id,
          jsonb_build_object('reason', p_reason, 'amount', v_orig.amount,
                             'document_id', v_orig.document_id, 'method', v_orig.method));

  return v_mirror;
end $$;


-- Folded in from 202607110000035_convert_quote_intake_parity.sql (history repair 2026-09-10): that version stamp collided and the Supabase CLI cannot match 15-digit versions, so the two files ship as one. Applied out-of-band before this repair; already live. Do not split apart.

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
