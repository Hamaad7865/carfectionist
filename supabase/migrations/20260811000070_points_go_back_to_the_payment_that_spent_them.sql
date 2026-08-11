-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — two ways the points ledger got the arithmetic wrong.
--
-- Both found in a pre-deploy review and both reproduced against the live
-- database, rolled back. Both are in the points feature; the discount and
-- override work is untouched.
--
-- ── 1. REVERSING A POINTS PAYMENT INVENTED POINTS ───────────────────────────
-- app.spend_points wrote its ledger row against the DOCUMENT, and
-- app.unwind_points_for_payment credited back the sum of EVERY redeemed row on
-- that document while guarding idempotence per PAYMENT. A bill settled in two
-- points legs therefore refunded the whole document's redemption once per leg:
--
--     start 500 · spend 50 + 50 -> 400
--     reverse leg 1 -> 500      (credited 100, owed 50)
--     reverse leg 2 -> 600      (credited 100 again)
--
-- The customer ends 100 points richer than they began, and points buy services.
-- The redeemed row simply was not attributable to the payment that made it.
--
-- The fix is a payment_id on the ledger row. spend_points cannot know the id
-- today because record_payment mints it inline in the INSERT, several lines
-- AFTER the branch that calls spend_points — so the id is hoisted into a
-- variable and both use it. ref_type/ref_id stay pointed at the document, so
-- the customer's history keeps showing which sale each movement belongs to.
--
-- ── 2. A REVERSED BILL COULD NEVER RE-EARN ─────────────────────────────────
-- award_points_for_invoice ended with `on conflict do nothing` against a unique
-- index of one 'earned' row per document, forever. The unwind writes a
-- compensating 'reversed' row when a reversal drops a bill below settled. So
-- the ordinary sequence pay -> reverse -> pay again left the customer with
-- NOTHING on a fully-paid bill, permanently and silently:
--
--     pay in full -> 511 · reverse -> 500 · pay in full again -> 500
--
-- A cashier keying the wrong method once cost the customer their points. The
-- index made it impossible to fix in the function alone, so it goes.
--
-- What replaces it is the NET ledger position for the document: if earning and
-- un-earning already cancel out, the bill has no points on it and may earn
-- again. Idempotence — the thing `on conflict` was really there for, against an
-- offline replay or a retried part-payment — now comes from taking the customer
-- row lock that spend_points already takes, so two concurrent awards serialise
-- and the second sees the first's row.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the ledger remembers which payment spent the points ─────────────────────
-- The reference is DEFERRABLE INITIALLY DEFERRED on purpose: spend_points writes
-- this row BEFORE record_payment inserts the payment (that ordering is the point
-- of hoisting the id — the debit and the balance check must happen before the
-- money row lands). An immediate check fails on a payment that does not exist
-- yet; deferred, it is verified at commit, by which time it does. Referential
-- integrity is kept, just checked at the end of the transaction.
alter table public.customer_points_ledger
  add column if not exists payment_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customer_points_ledger_payment_id_fkey'
  ) then
    alter table public.customer_points_ledger
      add constraint customer_points_ledger_payment_id_fkey
      foreign key (payment_id) references public.payments(id)
      deferrable initially deferred;
  end if;
end $$;

comment on column public.customer_points_ledger.payment_id is
  'The payment that made this movement, when one did. Set on redemptions so a reversal can return exactly what THAT payment took; ref_type/ref_id still name the document, so the customer''s history reads as a story about sales.';

create index if not exists idx_points_ledger_payment
  on public.customer_points_ledger (payment_id) where payment_id is not null;

-- ── spending: attribute the row to its payment ──────────────────────────────
drop function if exists app.spend_points(uuid, numeric);

create or replace function app.spend_points(p_invoice uuid, p_amount numeric, p_payment_id uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
declare
  v_doc    public.documents;
  v_value  numeric;
  v_needed int;
  v_have   int;
begin
  select * into v_doc from public.documents where id = p_invoice;
  if v_doc.customer_id is null then
    raise exception 'a points payment needs a customer on the bill';
  end if;

  select point_value_rupees into v_value from public.business_settings where id = v_doc.tenant_id;
  if coalesce(v_value, 0) <= 0 then raise exception 'points have no value set'; end if;

  -- Round UP: the shop is never out of pocket for a fraction of a point.
  v_needed := ceil(p_amount / v_value)::int;

  select points_balance into v_have from public.customers
   where id = v_doc.customer_id for update;
  if coalesce(v_have, 0) < v_needed then
    raise exception 'not enough points: % needed, % available', v_needed, coalesce(v_have, 0);
  end if;

  insert into public.customer_points_ledger
    (tenant_id, customer_id, delta, reason, ref_type, ref_id, payment_id, created_by)
  values
    (v_doc.tenant_id, v_doc.customer_id, -v_needed, 'redeemed', 'document', p_invoice,
     p_payment_id, app.current_app_user_id());
end $$;

-- ── unwinding: return what THIS payment took, not the document's total ──────
create or replace function app.unwind_points_for_payment(p_payment uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  v_pay    public.payments;
  v_doc    public.documents;
  v_paid   numeric;
  v_spent  int;
  v_earned int;
begin
  select * into v_pay from public.payments where id = p_payment;
  if not found then return; end if;
  select * into v_doc from public.documents where id = v_pay.document_id;
  if v_doc.customer_id is null then return; end if;

  -- 1. a reversed points payment returns exactly what IT took — keyed on
  --    payment_id, so a bill settled in several points legs refunds each leg
  --    once and only once.
  if v_pay.method = 'points' then
    select coalesce(-sum(delta), 0) into v_spent
      from public.customer_points_ledger
     where reason = 'redeemed' and payment_id = p_payment;
    if v_spent > 0 and not exists (
      select 1 from public.customer_points_ledger
       where ref_type = 'payment' and ref_id = p_payment and reason = 'reversed'
    ) then
      insert into public.customer_points_ledger
        (tenant_id, customer_id, delta, reason, ref_type, ref_id, payment_id, note, created_by)
      values (v_doc.tenant_id, v_doc.customer_id, v_spent, 'reversed', 'payment', p_payment,
              p_payment, 'points returned on a reversed payment', app.current_app_user_id());
    end if;
  end if;

  -- 2. a bill that is no longer settled un-earns. Net, so a bill that has
  --    already un-earned once is not un-earned twice.
  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = v_doc.id;
  if v_paid < v_doc.total_incl then
    select coalesce(sum(delta), 0) into v_earned
      from public.customer_points_ledger
     where ref_type = 'document' and ref_id = v_doc.id and reason in ('earned', 'reversed');
    if v_earned > 0 then
      insert into public.customer_points_ledger
        (tenant_id, customer_id, delta, reason, ref_type, ref_id, note, created_by)
      values (v_doc.tenant_id, v_doc.customer_id, -v_earned, 'reversed', 'document', v_doc.id,
              'the bill is no longer settled in full', app.current_app_user_id());
    end if;
  end if;
end $$;

-- ── earning: net position, not row existence ────────────────────────────────
-- The index has to go first: while it stands, no bill can ever earn a second
-- time, which is the whole bug.
drop index if exists public.idx_points_ledger_one_earn_per_doc;

create or replace function app.award_points_for_invoice(p_invoice uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  v_doc      public.documents;
  v_rate     numeric;
  v_points   numeric;
  v_pts_paid numeric;
  v_net      int;
begin
  select * into v_doc from public.documents where id = p_invoice;
  if not found or v_doc.customer_id is null then return; end if;
  if v_doc.total_incl <= 0 then return; end if;

  select points_per_100 into v_rate from public.business_settings where id = v_doc.tenant_id;
  if coalesce(v_rate, 0) <= 0 then return; end if;

  -- Serialise concurrent awards on the customer row — the same lock spend_points
  -- takes. This is what makes the check-then-insert below safe against an offline
  -- sale replaying beside a retried part-payment, which is the job the old
  -- `on conflict do nothing` was really doing.
  perform 1 from public.customers where id = v_doc.customer_id for update;

  -- Has this bill already got its points? NET, so a bill that earned and was then
  -- un-earned by a reversal reads as zero and may earn again when it is re-paid.
  select coalesce(sum(delta), 0) into v_net
    from public.customer_points_ledger
   where ref_type = 'document' and ref_id = p_invoice and reason in ('earned', 'reversed');
  if v_net > 0 then return; end if;

  select coalesce(sum(amount), 0) into v_pts_paid
    from public.payments where document_id = p_invoice and method = 'points';

  v_points := floor(greatest(v_doc.total_incl - v_pts_paid, 0) / 100.0 * v_rate);
  if v_points < 1 then return; end if;

  insert into public.customer_points_ledger
    (tenant_id, customer_id, delta, reason, ref_type, ref_id, created_by)
  values
    (v_doc.tenant_id, v_doc.customer_id, v_points::int, 'earned', 'document', p_invoice,
     app.current_app_user_id());
end $$;

-- ── record_payment: mint the payment id BEFORE spending the points ──────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_payment';
  if v_def is null then raise exception 'public.record_payment not found'; end if;
  if position('v_pay_id' in v_def) > 0 then return; end if;

  if position('  v_pay    public.payments;' in v_def) = 0
     or position('perform app.spend_points(p_invoice_id, p_amount);' in v_def) = 0
     or position('(coalesce(p_payment_id, gen_random_uuid()), v_tenant, p_invoice_id, p_method, p_amount,' in v_def) = 0 then
    raise exception 'record_payment: anchors not found — the payment id was NOT hoisted';
  end if;

  v_def := replace(v_def,
    '  v_pay    public.payments;',
    '  v_pay    public.payments;
  -- Minted here rather than inline in the INSERT below, because app.spend_points
  -- runs BEFORE that insert and has to stamp the ledger row with this id.
  v_pay_id uuid := coalesce(p_payment_id, gen_random_uuid());');

  v_def := replace(v_def,
    'perform app.spend_points(p_invoice_id, p_amount);',
    'perform app.spend_points(p_invoice_id, p_amount, v_pay_id);');

  v_def := replace(v_def,
    '(coalesce(p_payment_id, gen_random_uuid()), v_tenant, p_invoice_id, p_method, p_amount,',
    '(v_pay_id, v_tenant, p_invoice_id, p_method, p_amount,');

  execute v_def;
end $$;

-- ── prove it against what is actually installed ─────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_payment';

  if position('spend_points(p_invoice_id, p_amount, v_pay_id)' in v_def) = 0 then
    raise exception 'record_payment does not pass the payment id to spend_points';
  end if;
  -- The splice must not have cost the function anything it already had.
  if position('award_points_for_invoice' in v_def) = 0 then
    raise exception 'record_payment lost its points earning';
  end if;
  if position('job_delivered' in v_def) = 0 then
    raise exception 'record_payment lost its job-delivery branch';
  end if;
  if position('gen_random_uuid()' in v_def) = 0 then
    raise exception 'record_payment no longer mints a payment id at all';
  end if;

  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_points_ledger_one_earn_per_doc') then
    raise exception 'the one-earn-per-document index still stands; a re-paid bill can never re-earn';
  end if;
end $$;
