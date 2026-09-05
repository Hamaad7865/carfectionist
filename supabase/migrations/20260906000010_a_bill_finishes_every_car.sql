-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a bill that covers three cars must FINISH all three
--
-- Found by reading the database back after the first real multi-car sale
-- (TESTINV-0110: one bill, three cars, paid in full). Two faults, both from the
-- same root: documents.job_id names ONE job, and every collection path still
-- asked it "which job is this bill for?".
--
--   1. Paying the bill delivered ONE car. The other two sat at 'ready' with the
--      money already in the drawer and the cars already gone — work that can
--      never be closed, on a board that says it is still owed.
--   2. deliver_paid_job — the board's own "hand it back" button — looks the bill
--      up by that same single link, so on cars two and three it answered "the job
--      has no invoice, bill it first" about a bill already paid in full.
--
-- (A third fear turned out to be unfounded and is recorded here so nobody goes
-- looking for it again: create_document_from_job cannot double-bill a car. It
-- delegates to convert_quote_to_invoice, which is idempotent per quote, and every
-- car of a visit shares one quote — so "bill this car" hands back the same bill.)
--
-- The junction written by the previous migration (document_jobs) is the answer
-- to "which jobs does this bill cover"; app.invoice_jobs() reads it, falling
-- back to documents.job_id so every document raised before it existed still
-- works. Every delivery path now goes through it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Every job a document covers — the junction, plus the legacy single link ──
create or replace function app.invoice_jobs(p_document_id uuid)
returns table (job_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select dj.job_id from public.document_jobs dj where dj.document_id = p_document_id
  union
  select d.job_id from public.documents d where d.id = p_document_id and d.job_id is not null
$$;
comment on function app.invoice_jobs(uuid) is
  'The jobs a document covers. One row for the ordinary bill; one per car for a '
  'bill raised over a visit that brought several.';

-- ─── 1. record_payment — the payment hands back every car it settles ────────
CREATE OR REPLACE FUNCTION public.record_payment(p_invoice_id uuid, p_method payment_method, p_amount numeric, p_tendered numeric DEFAULT NULL::numeric, p_external_ref text DEFAULT NULL::text, p_cash_session_id uuid DEFAULT NULL::uuid, p_payment_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_doc    public.documents;
  v_pay    public.payments;
  -- Minted here rather than inline in the INSERT below, because app.spend_points
  -- runs BEFORE that insert and has to stamp the ledger row with this id.
  v_pay_id uuid := coalesce(p_payment_id, gen_random_uuid());
  v_change numeric;
  v_paid   numeric;
  v_existing uuid;
  v_job_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || p_idempotency_key)::bigint);
    select (result->>'payment_id')::uuid into v_existing
      from public.idempotency_keys where tenant_id = v_tenant and key = p_idempotency_key;
    if v_existing is not null then
      select * into v_pay from public.payments where id = v_existing;
      if v_pay.document_id is distinct from p_invoice_id then
        raise exception 'idempotency key was already used for a different invoice';
      end if;
      return v_pay;
    end if;
  end if;

  select * into v_doc from public.documents
   where id = p_invoice_id and tenant_id = v_tenant for update;
  if not found then raise exception 'invoice not found'; end if;
  if v_doc.doc_type <> 'invoice' then raise exception 'payments attach to invoices only'; end if;
  if v_doc.status not in ('issued','partly_paid') then
    raise exception 'invoice is not open for payment (status %)', v_doc.status;
  end if;
  if p_amount <= 0 then raise exception 'payment amount must be positive'; end if;
  if p_amount > (v_doc.total_incl - v_doc.amount_paid) + 0.001 then
    raise exception 'payment % exceeds outstanding balance %', p_amount, v_doc.total_incl - v_doc.amount_paid;
  end if;

  -- EVERY payment is taken ON an open till — money belongs to a service. Cash
  -- because it moves a physical drawer; card/Juice/bank because a payment booked
  -- to no session appears on no Z-report ever (the day counted its ticket while
  -- the means-of-payment split silently lost the money).
  if p_cash_session_id is null then
    raise exception 'a % payment must be taken on an open till — open the till first', p_method;
  end if;
  -- FOR SHARE, not a bare read: close_service takes FOR UPDATE on this same row before it
  -- sums the drawer, so a shared lock here makes the two order themselves. Without it the
  -- window is real — this transaction reads the session as open, the close commits, and then
  -- this payment lands against a session already summed and sealed. The money is genuinely
  -- taken and the invoice says paid, but no Z-report will ever contain it and a closed
  -- session cannot be reopened, so the drawer is short for good with nothing to explain it.
  --
  -- Shared, so concurrent payments on one till still run in parallel; only a close waits.
  -- If the close wins the race, READ COMMITTED re-checks this row against the committed
  -- version, the status = 'open' filter no longer matches, and the cashier is told the till
  -- is closed — which is recoverable. Losing the money silently is not.
  perform 1 from public.cash_sessions
   where id = p_cash_session_id and tenant_id = v_tenant and status = 'open'
   for share;
  if not found then raise exception 'unknown or closed cash session'; end if;

  if p_method = 'points' then
    -- The ledger row IS the reference; the else-branch below wants an external
    -- one, which only makes sense for card, Juice and a bank transfer.
    perform app.spend_points(p_invoice_id, p_amount, v_pay_id);
    p_tendered := null; v_change := null;
  elsif p_method = 'cash' then
    p_tendered := coalesce(p_tendered, p_amount);
    if p_tendered < p_amount then raise exception 'tendered is less than amount'; end if;
    v_change := p_tendered - p_amount;
  else
    if p_external_ref is null and p_method <> 'cheque' then raise exception 'a % payment requires an external reference', p_method; end if;
    p_tendered := null; v_change := null;
  end if;

  insert into public.payments
    (id, tenant_id, document_id, method, amount, tendered, change_given, external_ref,
     cash_session_id, booked_session_id, received_by)
  values
    (v_pay_id, v_tenant, p_invoice_id, p_method, p_amount,
     p_tendered, v_change, p_external_ref,
     p_cash_session_id, p_cash_session_id, v_actor)
  returning * into v_pay;

  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = p_invoice_id;
  update public.documents
     set amount_paid = v_paid,
         status = (case when v_paid >= total_incl then 'paid' else 'partly_paid' end)::doc_status
   where id = p_invoice_id;

  -- Collection is the handover: a READY job whose bill is now settled in full
  -- moves to delivered — the customer paid and drove off.
  -- Settled in full: the sale earns its points, once. See 20260811000030.
  if v_paid >= v_doc.total_incl then
    perform app.award_points_for_invoice(p_invoice_id);
  end if;

  -- EVERY car on this bill, not just the one documents.job_id happens to name.
  -- Three cars settled by one payment means three cars handed back.
  if v_paid >= v_doc.total_incl then
    for v_job_id in select ij.job_id from app.invoice_jobs(p_invoice_id) ij loop
      update public.jobs
         set status = 'delivered', delivered_at = now()
       where id = v_job_id and tenant_id = v_tenant and status = 'ready';
      if found then
        insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
        values (v_tenant, v_actor, 'job_delivered', 'job', v_job_id,
                jsonb_build_object('invoice', v_doc.number, 'via', 'payment collected'));
      end if;
    end loop;
  end if;

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (tenant_id, key, rpc, result)
    values (v_tenant, p_idempotency_key, 'record_payment', jsonb_build_object('payment_id', v_pay.id))
    on conflict (tenant_id, key) do nothing;
  end if;

  return v_pay;
end $function$
;

-- ─── 2. deliver_on_account — the same, for a car that leaves unpaid ─────────
CREATE OR REPLACE FUNCTION public.deliver_on_account(p_invoice_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_doc    public.documents;
  v_moved  boolean := false;
  v_job_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  -- The same gate the jobs guard enforces for a delivery.
  perform app.require_role('owner','manager','cashier');

  select * into v_doc from public.documents
   where id = p_invoice_id and tenant_id = v_tenant for update;
  if not found then raise exception 'invoice not found'; end if;
  if v_doc.doc_type <> 'invoice' then raise exception 'on-account applies to invoices only'; end if;
  if v_doc.status not in ('issued','partly_paid') then
    raise exception 'invoice is not open for collection (status %)', v_doc.status;
  end if;
  -- Credit needs someone to owe the money — never a walk-in.
  if v_doc.customer_id is null then
    raise exception 'an on-account collect needs a customer';
  end if;

  -- Collection is the handover: the car left on account, so a READY job delivers.
  -- The invoice is deliberately left outstanding (this records NO payment).
  for v_job_id in select ij.job_id from app.invoice_jobs(p_invoice_id) ij loop
    update public.jobs
       set status = 'delivered', delivered_at = now()
     where id = v_job_id and tenant_id = v_tenant and status = 'ready';
    if found then
      v_moved := true;
      insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
      values (v_tenant, v_actor, 'job_delivered', 'job', v_job_id,
              jsonb_build_object('invoice', v_doc.number, 'via', 'taken on account'));
    end if;
  end loop;

  return v_moved;
end $function$
;

-- ─── 3. deliver_paid_job — cars two and three have a bill too ──────────────
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
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  -- The job's one live invoice. Found through the junction as well as job_id:
  -- on a bill covering three cars only the first is named by job_id, and the
  -- other two were told "bill it first" about a bill already paid.
  select * into v_doc from public.documents d
   where d.tenant_id = v_tenant and d.doc_type = 'invoice' and d.status <> 'void'
     and (d.job_id = p_job_id
          or exists (select 1 from public.document_jobs dj
                      where dj.document_id = d.id and dj.job_id = p_job_id))
   order by d.created_at
   limit 1
   for update;
  if not found then raise exception 'the job has no invoice — bill it first'; end if;
  if v_doc.status <> 'paid' then
    raise exception 'the bill is not settled (status %) — collect at checkout', v_doc.status;
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
end $function$
;

-- ─── No stale overloads ──────────────────────────────────────────────────────
do $$
declare n int; fn text;
begin
  foreach fn in array array['record_payment','deliver_on_account','deliver_paid_job'] loop
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn;
    if n <> 1 then raise exception '% has % definitions — a stale overload is live', fn, n; end if;
  end loop;
end $$;
