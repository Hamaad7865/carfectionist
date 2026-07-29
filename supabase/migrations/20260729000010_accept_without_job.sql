-- Accepting a quote and STARTING THE WORK become two separate decisions.
--
-- 1. accept_quote() — the customer agrees the price and signs, and nothing goes on the
--    board. A quote accepted today for work booked next month should not put a car in
--    the bay tonight.
-- 2. convert_quote_to_job() now accepts an ALREADY-ACCEPTED quote that has no job, so the
--    customer who comes back a month later gets their job from the quote they signed
--    rather than a re-keyed copy of it. Regenerated from the live definition; only the
--    status gate changed.

CREATE OR REPLACE FUNCTION public.convert_quote_to_job(p_quote_id uuid, p_technician_id uuid, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_signature jsonb DEFAULT NULL::jsonb)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_actor   uuid := app.current_app_user_id();
  v_q       public.documents;
  v_job     public.jobs;
  v_service text;
  v_sig     jsonb := case when p_signature is null then null
                          else p_signature || jsonb_build_object('at', now()) end;
  r         jsonb;
  v_old     public.documents;
  v_new_inv public.documents;
  v_pay     public.payments;
  v_carried numeric := 0;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents
   where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;

  -- Idempotent: already converted — hand back the same job, but back-fill the
  -- signature if the first accept's response was lost before the client saw it.
  select * into v_job from public.jobs
   where source_quote_id = v_q.id and tenant_id = v_tenant;
  if found then
    if v_sig is not null and v_q.accepted_signature is null then
      update public.documents set accepted_signature = v_sig where id = v_q.id;
    end if;
    return v_job;
  end if;

  if v_q.customer_id is null then raise exception 'this quote has no customer — add one before starting a job'; end if;
  if v_q.vehicle_id  is null then raise exception 'this quote has no vehicle — add one before starting a job'; end if;
  if p_technician_id is not null and not exists (
    select 1 from public.app_users where id = p_technician_id and tenant_id = v_tenant
  ) then raise exception 'unknown technician'; end if;

  if v_q.status = 'draft' then
    select * into v_q from public.issue_document(v_q.id, null, 'quote-accept:' || v_q.id);
  elsif v_q.status = 'accepted' then
    -- Already signed, no job yet: the customer accepted the price and went away, and has now
    -- come back for the work. Converting is exactly what should happen. A quote that already
    -- HAS a job falls through to the idempotent branch below and returns that same job.
    null;
  elsif v_q.status <> 'issued' then
    raise exception 'this quote is % and cannot be converted to a job', v_q.status;
  end if;

  select title into v_service from public.document_lines
   where document_id = v_q.id order by sort_order limit 1;

  -- A REVISION of a quote whose job is still alive. Same car, same job — only the agreed
  -- price moved, so accept it against the card already on the board. A CANCELLED job is
  -- not eligible: jobs_guard has no way out of 'cancelled', so re-pricing one would bury
  -- the work where no screen can reach it. Those fall through and open a fresh job.
  if v_q.source_document_id is not null and v_q.job_id is not null then
    select * into v_job from public.jobs
     where id = v_q.job_id and tenant_id = v_tenant and status <> 'cancelled';
    if found then
      -- An invoice raised from a quote BEFORE it had a job carries job_id NULL, which hid
      -- it from the guard below and let a second live invoice through. Claim it first.
      update public.documents
         set job_id = v_job.id
       where tenant_id = v_tenant and doc_type = 'invoice'
         and status <> 'void' and job_id is null
         and source_document_id in (
           select id from public.documents
            where tenant_id = v_tenant and doc_type = 'quote'
              and (id = v_q.id or id = v_q.source_document_id)
         );

      update public.jobs
         set notes         = coalesce(nullif(btrim(v_service), ''), notes),
             technician_id = coalesce(p_technician_id, technician_id),
             scheduled_at  = coalesce(p_scheduled_at, scheduled_at)
       where id = v_job.id
       returning * into v_job;

      -- Accept the revision BEFORE re-billing: convert_quote_to_invoice bills the
      -- last ACCEPTED quote, which must be this one.
      update public.documents
         set status = 'accepted', job_id = v_job.id,
             accepted_signature = coalesce(v_sig, accepted_signature)
       where id = v_q.id;

      -- The job is already billed? Then this accept IS a re-price: retire the old
      -- bill, carry any deposit forward, and bill the revision — one transaction.
      select * into v_old from public.documents
       where tenant_id = v_tenant and job_id = v_job.id
         and doc_type = 'invoice' and status <> 'void'
       for update;
      if found and v_old.source_document_id is distinct from v_q.id then
        if v_old.status = 'draft' then
          -- Never issued: no number, no money — it simply goes.
          delete from public.document_lines where document_id = v_old.id;
          delete from public.documents where id = v_old.id;
        else
          -- Transfer the deposit OFF the old bill: paired ledger rows booked to no
          -- session — no drawer or Z impact, the money already counted on the day
          -- it was taken. The OUT mirror marks each payment reversed, so the old
          -- bill recomputes to unpaid and nothing can double-collect it.
          for v_pay in
            select * from public.payments p
             where p.tenant_id = v_tenant and p.document_id = v_old.id
               and p.amount > 0 and p.reverses_payment_id is null
               and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
          loop
            insert into public.payments
              (tenant_id, document_id, method, amount, external_ref, reverses_payment_id,
               cash_session_id, booked_session_id, received_by)
            values
              (v_tenant, v_old.id, v_pay.method, -v_pay.amount,
               'moved to revised bill', v_pay.id, v_pay.cash_session_id, null, v_actor);
            v_carried := v_carried + v_pay.amount;
          end loop;
          update public.documents
             set amount_paid = 0,
                 status = 'issued'::doc_status
           where id = v_old.id;

          -- Void the now-unpaid old bill (inline: this path is open to the cashier
          -- who takes the signature, unlike owner/manager-only void_document) and
          -- put its stocked items back — the revision's issue will draw them again.
          insert into public.stock_movements
            (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, ref_line_id, created_by, note)
          select tenant_id, product_id, location_id, -qty, unit_cost, 'invoice', ref_id, null, v_actor, 'void reversal (re-priced)'
          from public.stock_movements
          where tenant_id = v_tenant and ref_type = 'invoice' and ref_id = v_old.id and ref_line_id is not null;
          update public.documents
             set status = 'void', voided_at = now(),
                 void_reason = 'Re-priced — replaced by revision ' || coalesce(v_q.number, '')
           where id = v_old.id;
          insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
          values (v_tenant, v_actor, 'document_voided', 'document', v_old.id,
                  jsonb_build_object('reason', 're-priced by revision ' || coalesce(v_q.number, ''),
                                     'replaced_by_quote', v_q.id));
        end if;

        -- Bill the revision NOW and land the deposit on it, so checkout shows the
        -- honest balance the moment the customer signs.
        select * into v_new_inv from public.convert_quote_to_invoice(v_q.id);
        if v_new_inv.status = 'draft' then
          select * into v_new_inv from public.issue_document(v_new_inv.id, null, 'reprice:' || v_q.id, null);
        end if;
        if v_carried > 0 then
          -- A standing positive cash row must satisfy the tender arithmetic check;
          -- a transfer changes no hands, so tendered = amount, change 0.
          insert into public.payments
            (tenant_id, document_id, method, amount, tendered, change_given, external_ref,
             reverses_payment_id, cash_session_id, booked_session_id, received_by)
          select v_tenant, v_new_inv.id, p.method, p.amount,
                 case when p.method = 'cash' then p.amount end,
                 case when p.method = 'cash' then 0::numeric end,
                 'deposit from ' || coalesce(v_old.number, 'previous bill'),
                 null, p.cash_session_id, null, p.received_by
            from public.payments p
           where p.tenant_id = v_tenant and p.document_id = v_old.id
             and p.amount > 0 and p.reverses_payment_id is null;
          update public.documents d
             set amount_paid = sub.paid,
                 status = (case when sub.paid >= d.total_incl then 'paid' else 'partly_paid' end)::doc_status
            from (select coalesce(sum(amount),0) paid from public.payments where document_id = v_new_inv.id) sub
           where d.id = v_new_inv.id;
        end if;
      end if;

      insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
      values (v_tenant, v_actor, 'quote_revision_accepted', 'document', v_q.id,
              jsonb_build_object('job_id', v_job.id, 'quote_number', v_q.number,
                                 'replaces', v_q.source_document_id, 'signed', v_sig is not null,
                                 'rebilled', v_new_inv.number, 'deposit_carried', v_carried));

      return v_job;
    end if;
  end if;

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

  -- Same claim for a first accept: the builder's "Bill now" can have raised an invoice
  -- from this quote before any job existed.
  update public.documents
     set job_id = v_job.id
   where tenant_id = v_tenant and doc_type = 'invoice'
     and status <> 'void' and job_id is null
     and source_document_id = v_q.id;

  for r in select value from jsonb_array_elements(coalesce(v_q.intake->'photos', '[]'::jsonb)) loop
    if nullif(r->>'path', '') is not null then
      insert into public.job_photos (tenant_id, job_id, storage_path, caption, phase, created_by)
      values (v_tenant, v_job.id, r->>'path', nullif(r->>'caption', ''), 'before', v_actor);
    end if;
  end loop;

  update public.documents
     set status = 'accepted', job_id = v_job.id,
         accepted_signature = coalesce(v_sig, accepted_signature)
   where id = v_q.id;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'quote_converted_to_job', 'document', v_q.id,
          jsonb_build_object('job_id', v_job.id, 'quote_number', v_q.number,
                             'signed', v_sig is not null));

  return v_job;
end $function$
;

-- Issue + accept a quote WITHOUT creating a job. Same signature handling and the same
-- guards as the convert path, minus the board.
create or replace function public.accept_quote(p_quote_id uuid, p_signature jsonb default null)
returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_q      public.documents;
  v_sig    jsonb := case when p_signature is null then null
                         else p_signature || jsonb_build_object('at', now()) end;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'that document is not a quote'; end if;
  if v_q.customer_id is null then raise exception 'this quote has no customer — add one before accepting it'; end if;

  if v_q.status = 'draft' then
    select * into v_q from public.issue_document(v_q.id, null, 'quote-accept:' || v_q.id);
  elsif v_q.status not in ('issued','accepted') then
    raise exception 'this quote is % and cannot be accepted', v_q.status;
  end if;

  if v_sig is not null then
    update public.documents set accepted_signature = v_sig where id = v_q.id;
  end if;
  update public.documents set status = 'accepted' where id = v_q.id and status <> 'accepted'
    returning * into v_q;
  if v_q.id is null then select * into v_q from public.documents where id = p_quote_id; end if;

  return v_q;
end $$;
revoke execute on function public.accept_quote(uuid, jsonb) from public;
grant  execute on function public.accept_quote(uuid, jsonb) to authenticated;
