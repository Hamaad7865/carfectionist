-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — the line keeps one bill
--
-- (Sandbox tablet, 2026-09-09, 21:31.) "nick summer test" was quoted
-- TESTQ-00048 — a dash cam and a sedan polish, Rs 18,150.01 — and billed at
-- the counter in the same breath: draft bill, no job, the ordinary shape of a
-- counter sale. Over the next thirty seconds the price moved three times,
-- 48 → 49 → 50 → 51, each revised from the last, TESTQ-00051 accepted with a
-- technician and billed at Rs 18,700.01. TESTQ-00048's draft never went
-- anywhere. Checkout showed two payable bills for one price; the till took the
-- superseded Rs 18,150.01 (TESTINV-0119, now paid), and the issue guard from
-- 20260909000010 then refused the standing Rs 18,700.01 one — correctly, but
-- only after the wrong money had moved.
--
-- WHY THE MACHINERY MISSED IT. 20260909000010 REFUSES — at the revise, at the
-- raise, at the issue — but nothing RETIRES. Its guards deliberately exempt
-- drafts ("a draft bill is not a bill yet") so the everyday revision is never
-- blocked; that leaves the old draft alive exactly when the line has moved on.
-- The one retirement that exists — convert_quote_to_job's re-price branch,
-- which deletes an old draft outright — is fenced behind
-- `v_q.source_document_id is not null and v_q.job_id is not null`, and a line
-- that starts job-less can never pass it: revise_quote copies the parent's
-- job_id down the whole line, and it was null from the first.
--
-- THE RULE. One bill per line, and it is the last price agreed. The moment a
-- new price is agreed, every DRAFT bill raised from a quote the line supersedes
-- goes — a draft carries no number and no money, and the re-price branch has
-- always deleted them exactly this way. Two doors run the retirement:
--   • the accept — convert_quote_to_job, so the old draft leaves the till the
--     moment the revision is signed, not when somebody eventually bills it;
--   • the bill — convert_quote_to_invoice, the one door every mint funnels
--     through (counter, job, multi-car, web and tablet alike).
-- And the idempotency branch learns one more place a line's bill can already
-- be: DOWNSTREAM. Billing a superseded quote used to mint a rival draft at the
-- rejected price, invisible to every guard — the chain walks
-- source_document_id UPWARD, so a child's bill is never in the parent's chain.
-- It now hands back the line's standing bill instead.
--
-- revision_of, NOT source_document_id, decides who supersedes whom
-- (20260909000020's lesson): a plain COPY links back but replaces nothing, and
-- must not have its original's drafts read as its own. LIVE bills are touched
-- by none of this — void or credit remains the owner's call, exactly as
-- 20260909000010 left it, and TESTINV-0119 stays exactly as it is.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── the quotes this one replaced ───────────────────────────────────────────
-- revision_of links, upward only, at any depth: a revision can itself be
-- revised (TESTQ-00051 sat three links above its root). revision_of rather
-- than source_document_id because duplicate_document writes that column for a
-- plain copy, and a copy supersedes nothing.
--
-- UNION, not UNION ALL: a corrupted revision_of cycle then terminates on the
-- duplicate instead of spinning for ever inside a customer's checkout.
create or replace function app.revision_parents(p_document_id uuid)
returns table (quote_id uuid)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with recursive up(id) as (
    select p_document_id
    union
    select q.revision_of
      from public.documents q
      join up u on q.id = u.id
     where q.revision_of is not null
       and q.doc_type = 'quote'
  )
  select u.id
    from up u
    join public.documents d on d.id = u.id
   where d.doc_type = 'quote'
     and d.id <> p_document_id
$fn$;

comment on function app.revision_parents(uuid) is
  'Every quote this one replaced through revision links, at any depth — a plain copy is not a revision and reaches nothing.';


-- ─── the retirement ─────────────────────────────────────────────────────────
-- Draft bills, raised from quotes this one supersedes, that no job owns. Both
-- halves matter, and both are app.superseded_bills' reasoning with 'draft' in
-- place of 'live':
--   • draft only — a live bill has a number and maybe money; unwinding one is
--     the owner's void-or-credit call, and 20260909000010 already refuses to
--     double-issue over it. A draft is not a bill yet, and the with-job
--     re-price path has always deleted one outright.
--   • owned by no job, on documents.job_id nor document_jobs — a bill a job
--     owns is a working document for work still in the bay, and the re-price
--     path retires it when the price moves.
-- Lines first, then the header, then one audit row each — discard_draft's own
-- order and wording, so the trail says what happened and why.
create or replace function app.discard_superseded_drafts(p_quote_id uuid)
returns integer
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  v_tenant uuid;
  v_actor  uuid := app.current_app_user_id();
  v_d      public.documents;
  v_n      integer := 0;
begin
  select tenant_id into v_tenant from public.documents where id = p_quote_id;
  if v_tenant is null then return 0; end if;

  for v_d in
    select i.*
      from public.documents i
     where i.tenant_id = v_tenant
       and i.doc_type = 'invoice'
       and i.status = 'draft'
       and i.job_id is null
       and not exists (select 1 from public.document_jobs dj where dj.document_id = i.id)
       and i.source_document_id in (select quote_id from app.revision_parents(p_quote_id))
     order by i.created_at
  loop
    delete from public.document_lines where document_id = v_d.id;
    delete from public.documents where id = v_d.id;
    insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
    values (v_tenant, v_actor, 'draft_discarded', 'document', v_d.id,
            jsonb_build_object('doc_type', 'invoice', 'total_incl', v_d.total_incl,
                               'replaced_by_quote', p_quote_id));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $fn$;

comment on function app.discard_superseded_drafts(uuid) is
  'Retires the draft bills left standing on quotes this one replaces. Drafts only, job-owned ones never: the new price is agreed, the old price''s unissued bill goes.';

revoke execute on function app.discard_superseded_drafts(uuid) from public;
revoke execute on function app.discard_superseded_drafts(uuid) from anon;


-- ─── 1. The bill door — every mint funnels through here ────────────────────
create or replace function public.convert_quote_to_invoice(p_quote_id uuid)
 returns documents
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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

  -- Whatever quote the caller named, bill the one that stands for this job: the price
  -- signed last, or — if none was ever signed — the price the customer was last quoted.
  -- Accepting a quote issues it, so quote numbers run in the order they were agreed.
  if v_q.job_id is not null then
    select * into v_inv from public.documents
     where tenant_id = v_tenant and job_id = v_q.job_id
       and doc_type = 'quote' and status in ('accepted','issued')
     order by (status = 'accepted') desc, number desc nulls last, created_at desc
     limit 1;
    if found and v_inv.id <> v_q.id then
      select * into v_q from public.documents where id = v_inv.id for update;
    end if;
  end if;

  -- S3: a declined / expired / void quote is not billable.
  if v_q.status not in ('draft','issued','accepted') then
    raise exception 'cannot invoice a % quote', v_q.status;
  end if;

  -- Idempotent, and S1: return an existing live invoice whether it was raised
  -- from THIS quote (source_document_id) or from the quote's JOB (job_id) —
  -- and, since 20260910000010, from a quote this line has moved on to: a
  -- revision downstream of this one, at any depth. The line keeps ONE bill and
  -- it is the last price agreed; minting a rival here is how a superseded price
  -- ended up beside the standing one at the till, invisible to the guard below
  -- (the chain walks upward — a child's bill is not in the parent's chain).
  -- revision_of decides, not source_document_id: a copy supersedes nothing.
  -- This quote's own bill first, then the line's newest.
  select * into v_inv from public.documents
   where doc_type = 'invoice' and tenant_id = v_tenant and status <> 'void'
     and ( source_document_id = v_q.id
           or (v_q.job_id is not null and job_id = v_q.job_id)
           or source_document_id in (
             select r.id
               from public.documents r
              where r.doc_type = 'quote'
                and r.status <> 'void'
                and v_q.id in (select quote_id from app.revision_parents(r.id))
           ))
   order by (source_document_id = v_q.id) desc, created_at desc
   limit 1;
  if found then return v_inv; end if;

  -- The line has moved on: every DRAFT bill raised from a quote this one
  -- supersedes is the price the customer rejected, standing at the till waiting
  -- for whoever taps it first — TESTQ-00048's Rs 18,150.01 draft stood beside
  -- TESTQ-00051's Rs 18,700.01 one, and was the one paid. A draft carries no
  -- number and no money, so it goes outright. LIVE bills are untouched: the
  -- assert below still makes them the owner's call.
  perform app.discard_superseded_drafts(v_q.id);

  -- Below the idempotency branch on purpose. A bill raised from THIS quote is this
  -- quote's own and has just been handed back; what is left can only be a bill raised
  -- from a quote this one SUPERSEDES, and minting a second number over it would charge
  -- the same goods twice. Handing the old one back instead would be worse still — it
  -- carries the price the customer rejected.
  perform app.assert_no_superseded_bill(v_q.id, 'The quotation behind this bill');

  -- Billing a quote nobody ever sent: the counter IS the negotiation, so raising the
  -- bill issues and accepts it in one move. Below the idempotency branch, so a replay
  -- hands back the invoice without minting a second number. See the header for what a
  -- draft left behind here costs: a row the app can neither open, archive nor delete.
  if v_q.status = 'draft' then
    update public.documents set
      number     = app.next_document_number(v_tenant, 'quote'),
      status     = 'accepted',
      -- the MAURITIUS calendar day, as issue_document stamps it (UTC evenings
      -- otherwise file the day before)
      issue_date = coalesce(issue_date, ((now() at time zone 'utc') + interval '4 hours')::date),
      issued_at  = coalesce(issued_at, now())
     where id = v_q.id
    returning * into v_q;
  end if;

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, discount_kind, discount_value, created_by)
  values
    (v_new, v_tenant, 'invoice', 'draft', v_q.customer_id, v_q.vehicle_id, v_q.job_id, v_q.id,
     v_q.template_id, v_q.template_overrides, v_q.currency, v_q.origin, v_q.discount_kind, v_q.discount_value, app.current_app_user_id())
  returning * into v_inv;

  insert into public.document_lines
    (tenant_id, document_id, product_id, vehicle_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind, price_includes_vat)
  select v_tenant, v_new, product_id, vehicle_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind, price_includes_vat
  from public.document_lines where document_id = v_q.id;

  -- One bill, every car's job. Without this, cars two and three read as never
  -- invoiced on the board — documents.job_id can only name one of them.
  insert into public.document_jobs (tenant_id, document_id, job_id)
  select v_tenant, v_new, j.id
    from public.jobs j
   where j.tenant_id = v_tenant
     and (j.source_quote_id = v_q.id or (v_q.job_id is not null and j.id = v_q.job_id))
  on conflict do nothing;

  update public.documents set status = 'accepted' where id = v_q.id and status = 'issued';
  select * into v_inv from public.documents where id = v_new;
  return v_inv;
end $function$;


-- ─── 2. The accept door — the old draft leaves the till at the signature ────
create or replace function public.convert_quote_to_job(p_quote_id uuid, p_technician_id uuid, p_scheduled_at timestamp with time zone default null::timestamp with time zone, p_signature jsonb default null::jsonb)
 returns jobs
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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

  -- Several cars on this quote: the multi-car path owns it. Making ONE job here
  -- would put car one on the board and quietly lose the other two — the single
  -- failure mode this feature must not have. Delegation, not truncation.
  if (select count(*) from app.document_cars(v_q.id)) > 1 then
    return (select j from public.convert_quote_to_jobs(p_quote_id, p_technician_id, p_scheduled_at, p_signature) j
             order by j.created_at, j.id limit 1);
  end if;

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

  -- The new price is agreed the moment this signature is taken: every draft
  -- bill still standing on a quote this one supersedes leaves the till NOW,
  -- not when the revision is eventually billed. A line that starts job-less
  -- has no re-price branch to retire it (20260910000010) — this is that
  -- retirement, at the accept. This quote's OWN bill is safe: it hangs off no
  -- parent, and the claim below gives it this job.
  perform app.discard_superseded_drafts(v_q.id);

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
     coalesce(app.intake_for_vehicle(v_q.intake, v_q.vehicle_id)->'markers', '[]'::jsonb),
     v_q.id, v_actor)
  returning * into v_job;

  -- Same claim for a first accept: the builder's "Bill now" can have raised an invoice
  -- from this quote before any job existed.
  update public.documents
     set job_id = v_job.id
   where tenant_id = v_tenant and doc_type = 'invoice'
     and status <> 'void' and job_id is null
     and source_document_id = v_q.id;

  for r in select value from jsonb_array_elements(
             coalesce(app.intake_for_vehicle(v_q.intake, v_q.vehicle_id)->'photos', '[]'::jsonb)) loop
    if nullif(r->>'path', '') is not null then
      insert into public.job_photos (tenant_id, job_id, storage_path, caption, phase, created_by)
      values (v_tenant, v_job.id, r->>'path', nullif(r->>'caption', ''), 'before', v_actor);
    end if;
  end loop;

  update public.documents
     set status = 'accepted', job_id = v_job.id,
         accepted_signature = coalesce(v_sig, accepted_signature)
   where id = v_q.id;

  insert into public.document_jobs (tenant_id, document_id, job_id)
  values (v_tenant, v_q.id, v_job.id) on conflict do nothing;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'quote_converted_to_job', 'document', v_q.id,
          jsonb_build_object('job_id', v_job.id, 'quote_number', v_q.number,
                             'signed', v_sig is not null));

  return v_job;
end $function$;


-- ─── prove it, against what is actually installed ───────────────────────────
do $$
declare
  v_def   text;
  v_open  int;
begin
  select pg_get_functiondef('app.revision_parents(uuid)'::regprocedure) into v_def;
  if position('revision_of' in v_def) = 0 then
    raise exception 'revision_parents walks source_document_id — a copy would retire its original''s drafts';
  end if;

  select pg_get_functiondef('app.discard_superseded_drafts(uuid)'::regprocedure) into v_def;
  if position('draft_discarded' in v_def) = 0 then
    raise exception 'the retirement leaves no audit trail';
  end if;

  -- Both regenerations below replace live functions: each must keep every guard
  -- it inherited, or applying this migration silently deletes it (000020's lesson).
  select pg_get_functiondef('public.convert_quote_to_invoice(uuid)'::regprocedure) into v_def;
  if position('discard_superseded_drafts' in v_def) = 0 then
    raise exception 'the bill path still lets a superseded draft stand at the till';
  end if;
  if position('assert_no_superseded_bill' in v_def) = 0 then
    raise exception 'convert_quote_to_invoice lost the superseded-bill guard from 20260909000010';
  end if;
  if position('revision_parents' in v_def) = 0 then
    raise exception 'billing a superseded quote can still mint a rival bill';
  end if;

  select pg_get_functiondef('public.convert_quote_to_job(uuid, uuid, timestamptz, jsonb)'::regprocedure) into v_def;
  if position('discard_superseded_drafts' in v_def) = 0 then
    raise exception 'accepting a revision still leaves its old draft at the till';
  end if;

  -- Say plainly what is already out there. NOT fixed here: clearing a live fiscal
  -- document is the owner's decision, one bill at a time — and drafts standing on
  -- lines nobody has re-agreed yet are nobody's business but the negotiation's.
  select count(*) into v_open
    from public.documents i
   where i.doc_type = 'invoice'
     and i.status = 'draft'
     and i.job_id is null
     and not exists (select 1 from public.document_jobs dj where dj.document_id = i.id)
     and exists (
       select 1 from public.documents r
        where r.doc_type = 'quote'
          and r.status not in ('draft','void')
          and i.source_document_id in (select quote_id from app.revision_parents(r.id))
     );
  if v_open > 0 then
    raise notice '% superseded draft bill(s) are still standing and are left untouched — each goes when its line is next agreed or billed', v_open;
  end if;

  raise notice 'the line keeps one bill: superseded drafts retire at the accept and at the bill, and billing a superseded quote returns the line''s standing bill';
end $$;

notify pgrst, 'reload schema';
