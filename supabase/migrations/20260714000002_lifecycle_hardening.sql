-- Lifecycle hardening (Sonnet bug-hunt round 2, verified findings).
-- 1) issue_document / create_and_issue_credit_note: customer lookups are now
--    tenant-checked (SECURITY DEFINER bypassed RLS on customers) and stamp the
--    MAURITIUS calendar day into issue_date (current_date = UTC day misfiled
--    evening documents into the previous day, skewing every dated report).
-- 2) issue_document / record_payment: idempotency replay now verifies the
--    stored result belongs to the SAME target (guessable keys like
--    quote-accept:<id> could otherwise hand back an unrelated document).
-- 3) reverse_payment: un-delivers a job that record_payment auto-delivered
--    when the reversal drops the invoice below fully-paid (+ audit event).
-- 4) jobs: transition guard trigger — identity columns immutable, only legal
--    status moves (scheduled->in_progress|ready|cancelled,
--    in_progress->ready|cancelled, ready->delivered, delivered->ready),
--    delivery restricted to owner/manager/cashier, cancel/un-deliver to
--    owner/manager. Service-role (no auth.uid) bypasses.
-- 5) Grants: clients never insert documents/document_lines or write
--    cash_sessions directly (verified against both apps) — revoked, so the
--    RPCs are the only doors.
-- 6) One live invoice per job, enforced by a partial unique index (the RPC
--    guards could be sidestepped via save_draft(job_id) + issue_document).
-- 7) Backfill: re-date the issue_date of any document misfiled by the UTC bug.

-- 1+2) issue_document ---------------------------------------------------------
create or replace function public.issue_document(
  p_document_id uuid,
  p_stock_location_id uuid default null,
  p_idempotency_key text default null
) returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_doc    public.documents;
  v_bs     public.business_settings;
  v_cust   public.customers;
  v_number text;
  v_location uuid;
  v_lines  int;
  v_existing uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || p_idempotency_key)::bigint);
    select (result->>'document_id')::uuid into v_existing
      from public.idempotency_keys where tenant_id = v_tenant and key = p_idempotency_key;
    if v_existing is not null then
      select * into v_doc from public.documents where id = v_existing;
      -- The key must belong to THIS document: a guessable key (quote-accept:<id>)
      -- must not hand back some other document issued under it earlier.
      if v_doc.id is distinct from p_document_id then
        raise exception 'idempotency key was already used for a different document';
      end if;
      return v_doc;
    end if;
  end if;

  select * into v_doc from public.documents
   where id = p_document_id and tenant_id = v_tenant for update;
  if not found then raise exception 'document not found'; end if;
  if v_doc.status <> 'draft' then raise exception 'document already issued (status %)', v_doc.status; end if;

  select count(*) into v_lines from public.document_lines where document_id = v_doc.id;
  if v_lines = 0 then raise exception 'cannot issue a document with no lines'; end if;
  if v_doc.doc_type = 'invoice' and v_doc.customer_id is null then
    raise exception 'an invoice requires a customer';
  end if;

  select * into v_bs from public.business_settings where id = v_tenant;
  if v_doc.customer_id is not null then
    -- Tenant-checked: SECURITY DEFINER bypasses RLS, and customer_id arrives on
    -- a client-writable draft — without this a foreign customer's identity
    -- could be stamped onto our fiscal snapshot.
    select * into v_cust from public.customers where id = v_doc.customer_id and tenant_id = v_tenant;
    if not found then raise exception 'customer does not belong to this tenant'; end if;
  end if;

  v_number := app.next_document_number(v_tenant, v_doc.doc_type);

  update public.documents set
    number             = v_number,
    status             = 'issued',
    issue_date         = ((now() at time zone 'utc') + interval '4 hours')::date, -- the MAURITIUS calendar day (current_date is the DB's UTC day: evening issues misfiled a day early)
    issued_at          = now(),
    issued_legal_name  = v_bs.legal_name,
    issued_brn         = v_bs.brn,
    issued_vat_number  = v_bs.vat_number,
    bill_to_name       = v_cust.name,
    bill_to_address    = v_cust.address,
    bill_to_brn        = v_cust.brn,
    bill_to_vat_number = v_cust.vat_number,
    vat_breakdown      = (
      select jsonb_agg(jsonb_build_object('rate', g.vat_rate, 'base', g.base, 'vat', g.vat) order by g.vat_rate)
      from (
        select vat_rate, sum(line_total_excl) as base, sum(line_vat) as vat
        from public.document_lines where document_id = v_doc.id group by vat_rate
      ) g
    )
  where id = v_doc.id returning * into v_doc;

  if v_doc.doc_type = 'invoice' then
    if p_stock_location_id is not null and not exists (
      select 1 from public.stock_locations where id = p_stock_location_id and tenant_id = v_tenant
    ) then raise exception 'unknown stock location'; end if;
    v_location := coalesce(
      p_stock_location_id,
      (select id from public.stock_locations where tenant_id = v_tenant and is_default limit 1)
    );
    if v_location is null and exists (
      select 1 from public.document_lines dl join public.products p on p.id = dl.product_id
      where dl.document_id = v_doc.id and p.is_stocked
    ) then raise exception 'no stock location — set a default location or pass one'; end if;
    insert into public.stock_movements
      (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, ref_line_id, created_by, note)
    select v_tenant, dl.product_id, v_location, -dl.qty, p.cost_price,
           'invoice', v_doc.id, dl.id, v_actor, 'sale on issue'
    from public.document_lines dl
    join public.products p on p.id = dl.product_id and p.tenant_id = v_tenant
    where dl.document_id = v_doc.id and p.is_stocked;
  end if;

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (tenant_id, key, rpc, result)
    values (v_tenant, p_idempotency_key, 'issue_document', jsonb_build_object('document_id', v_doc.id))
    on conflict (tenant_id, key) do nothing;
  end if;

  return v_doc;
end $$;

-- 1) create_and_issue_credit_note ---------------------------------------------
create or replace function public.create_and_issue_credit_note(
  p_invoice_id uuid,
  p_stock_location_id uuid default null,
  p_restock boolean default true
) returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_inv    public.documents;
  v_bs     public.business_settings;
  v_cust   public.customers;
  v_cn     public.documents;
  v_new    uuid := gen_random_uuid();
  v_number text;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

  select * into v_inv from public.documents where id = p_invoice_id and tenant_id = v_tenant for update;
  if not found then raise exception 'invoice not found'; end if;
  if v_inv.doc_type <> 'invoice' then raise exception 'credit notes are raised against invoices'; end if;
  if v_inv.status not in ('issued','partly_paid','paid') then raise exception 'only an issued invoice can be credited'; end if;

  if exists (
    select 1 from public.documents
     where tenant_id = v_tenant and doc_type = 'credit_note'
       and source_document_id = v_inv.id and status <> 'void'
  ) then raise exception 'this invoice already has a credit note'; end if;

  if p_stock_location_id is not null and not exists (
    select 1 from public.stock_locations where id = p_stock_location_id and tenant_id = v_tenant
  ) then raise exception 'unknown stock location'; end if;

  select * into v_bs from public.business_settings where id = v_tenant;
  if v_inv.customer_id is not null then
    -- Tenant-checked (same reasoning as issue_document).
    select * into v_cust from public.customers where id = v_inv.customer_id and tenant_id = v_tenant;
    if not found then raise exception 'customer does not belong to this tenant'; end if;
  end if;

  -- 1) draft credit note (header copied from the invoice, incl. its order discount)
  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, created_by, discount_kind, discount_value)
  values
    (v_new, v_tenant, 'credit_note', 'draft', v_inv.customer_id, v_inv.vehicle_id, v_inv.job_id, v_inv.id,
     v_inv.template_id, v_inv.template_overrides, v_inv.currency, v_inv.origin, v_actor,
     v_inv.discount_kind, v_inv.discount_value);

  -- 2) copy lines incl. their line-level discount (kind + pct + amount)
  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order)
  select v_tenant, v_new, product_id, title, description, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order
  from public.document_lines where document_id = v_inv.id;

  -- 3) assign the CN number + fiscal snapshot (draft->issued; fiscal lock not yet active)
  v_number := app.next_document_number(v_tenant, 'credit_note');
  update public.documents set
    number             = v_number,
    status             = 'issued',
    issue_date         = ((now() at time zone 'utc') + interval '4 hours')::date,
    issued_at          = now(),
    issued_legal_name  = v_bs.legal_name,
    issued_brn         = v_bs.brn,
    issued_vat_number  = v_bs.vat_number,
    bill_to_name       = v_cust.name,
    bill_to_address    = v_cust.address,
    bill_to_brn        = v_cust.brn,
    bill_to_vat_number = v_cust.vat_number,
    vat_breakdown      = (
      select jsonb_agg(jsonb_build_object('rate', g.vat_rate, 'base', g.base, 'vat', g.vat) order by g.vat_rate)
      from (select vat_rate, sum(line_total_excl) as base, sum(line_vat) as vat
            from public.document_lines where document_id = v_new group by vat_rate) g
    )
  where id = v_new returning * into v_cn;

  if p_restock then
    insert into public.stock_movements
      (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, ref_line_id, created_by, note)
    select v_tenant, m.product_id, coalesce(p_stock_location_id, m.location_id), -m.qty, m.unit_cost,
           'credit_note', v_cn.id, null, v_actor, 'credit note restock'
    from public.stock_movements m
    where m.tenant_id = v_tenant and m.ref_type = 'invoice' and m.ref_id = v_inv.id and m.ref_line_id is not null;
  end if;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'credit_note_issued', 'document', v_cn.id,
          jsonb_build_object('invoice_id', v_inv.id, 'number', v_number, 'restock', p_restock, 'amount', v_cn.total_incl));

  return v_cn;
end $$;

-- 3) reverse_payment ----------------------------------------------------------
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
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'a reason is required to reverse a payment';
  end if;

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

  -- Money walked back: a job auto-delivered on full payment must not stay
  -- "delivered" against an invoice that is no longer settled — return it to
  -- READY (exact mirror of record_payment's auto-deliver; this RPC is already
  -- owner/manager-only).
  if v_doc.job_id is not null and v_paid < v_doc.total_incl then
    update public.jobs
       set status = 'ready', delivered_at = null
     where id = v_doc.job_id and tenant_id = v_tenant and status = 'delivered';
    if found then
      insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
      values (v_tenant, v_actor, 'job_delivery_reversed', 'job', v_doc.job_id,
              jsonb_build_object('reason', trim(p_reason), 'invoice', v_doc.number));
    end if;
  end if;

  -- Refresh a CLOSED session's stored reconciliation (incl. till movements).
  if v_orig.cash_session_id is not null then
    update public.cash_sessions cs set
      expected_cash = cs.opening_float
        + coalesce((select sum(amount) from public.payments where cash_session_id = cs.id and method = 'cash'), 0)
        + coalesce((select sum(amount) from public.till_movements where cash_session_id = cs.id), 0),
      variance = cs.closing_count - (cs.opening_float
        + coalesce((select sum(amount) from public.payments where cash_session_id = cs.id and method = 'cash'), 0)
        + coalesce((select sum(amount) from public.till_movements where cash_session_id = cs.id), 0))
    where cs.id = v_orig.cash_session_id and cs.tenant_id = v_tenant and cs.status = 'closed';
  end if;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'payment_reversed', 'payment', v_orig.id,
          jsonb_build_object('reason', trim(p_reason), 'amount', v_orig.amount,
                             'document_id', v_orig.document_id, 'method', v_orig.method));

  return v_mirror;
end $$;

-- 2) record_payment -----------------------------------------------------------
create or replace function public.record_payment(
  p_invoice_id uuid,
  p_method payment_method,
  p_amount numeric,
  p_tendered numeric default null::numeric,
  p_external_ref text default null::text,
  p_cash_session_id uuid default null::uuid,
  p_payment_id uuid default null::uuid,
  p_idempotency_key text default null::text
) returns payments language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_doc    public.documents;
  v_pay    public.payments;
  v_change numeric;
  v_paid   numeric;
  v_existing uuid;
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
  if p_cash_session_id is not null and not exists (
    select 1 from public.cash_sessions where id = p_cash_session_id and tenant_id = v_tenant and status = 'open'
  ) then raise exception 'unknown or closed cash session'; end if;

  if p_method = 'cash' then
    p_tendered := coalesce(p_tendered, p_amount);
    if p_tendered < p_amount then raise exception 'tendered is less than amount'; end if;
    v_change := p_tendered - p_amount;
  else
    if p_external_ref is null then raise exception 'a % payment requires an external reference', p_method; end if;
    p_tendered := null; v_change := null;
  end if;

  insert into public.payments
    (id, tenant_id, document_id, method, amount, tendered, change_given, external_ref, cash_session_id, received_by)
  values
    (coalesce(p_payment_id, gen_random_uuid()), v_tenant, p_invoice_id, p_method, p_amount,
     p_tendered, v_change, p_external_ref, p_cash_session_id, v_actor)
  returning * into v_pay;

  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = p_invoice_id;
  update public.documents
     set amount_paid = v_paid,
         status = (case when v_paid >= total_incl then 'paid' else 'partly_paid' end)::doc_status
   where id = p_invoice_id;

  -- Collection is the handover: a READY job whose bill is now settled in full
  -- moves to delivered — the customer paid and drove off.
  if v_paid >= v_doc.total_incl and v_doc.job_id is not null then
    update public.jobs
       set status = 'delivered', delivered_at = now()
     where id = v_doc.job_id and tenant_id = v_tenant and status = 'ready';
    if found then
      insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
      values (v_tenant, v_actor, 'job_delivered', 'job', v_doc.job_id,
              jsonb_build_object('invoice', v_doc.number, 'via', 'payment collected'));
    end if;
  end if;

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (tenant_id, key, rpc, result)
    values (v_tenant, p_idempotency_key, 'record_payment', jsonb_build_object('payment_id', v_pay.id))
    on conflict (tenant_id, key) do nothing;
  end if;

  return v_pay;
end $function$;


-- 4) jobs state-machine guard --------------------------------------------------
create or replace function app.jobs_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
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
    if not ( (old.status = 'scheduled'   and new.status in ('in_progress','ready','cancelled'))
          or (old.status = 'in_progress' and new.status in ('ready','cancelled'))
          or (old.status = 'ready'       and new.status = 'delivered')
          or (old.status = 'delivered'   and new.status = 'ready') ) then
      raise exception 'illegal job transition: % -> %', old.status, new.status;
    end if;
    if new.status = 'delivered' and v_role not in ('owner','manager','cashier') then
      raise exception 'only owner, manager or cashier can mark a job delivered';
    end if;
    if new.status = 'cancelled' and v_role not in ('owner','manager') then
      raise exception 'only owner or manager can cancel a job';
    end if;
    if old.status = 'delivered' and new.status = 'ready' and v_role not in ('owner','manager') then
      raise exception 'only owner or manager can un-deliver a job';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_jobs_guard on public.jobs;
create trigger trg_jobs_guard before update on public.jobs
  for each row execute function app.jobs_guard();

-- 5) close the direct-write doors clients never use ---------------------------
revoke insert on public.documents from authenticated;
revoke insert, update, delete on public.document_lines from authenticated;
revoke insert, update, delete on public.cash_sessions from authenticated;

-- 6) one live invoice per job (DB-level backstop) ------------------------------
do $$
declare v_dupes int;
begin
  select count(*) into v_dupes from (
    select tenant_id, job_id from public.documents
    where doc_type = 'invoice' and job_id is not null and status <> 'void'
    group by tenant_id, job_id having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'cannot add one-invoice-per-job guard: % job(s) already carry multiple live invoices', v_dupes;
  end if;
end $$;

create unique index if not exists idx_invoice_one_per_job
  on public.documents (tenant_id, job_id)
  where doc_type = 'invoice' and job_id is not null and status <> 'void';

-- 7) re-date documents misfiled by the UTC issue_date bug ----------------------
alter table public.documents disable trigger trg_documents_fiscal_lock;
update public.documents
   set issue_date = ((issued_at at time zone 'utc') + interval '4 hours')::date
 where issued_at is not null and issue_date is not null
   and issue_date <> ((issued_at at time zone 'utc') + interval '4 hours')::date;
alter table public.documents enable trigger trg_documents_fiscal_lock;
