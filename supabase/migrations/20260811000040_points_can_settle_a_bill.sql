-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — points can settle a bill.
--
-- Rule 4 (2026-08-10): spending points is a TENDER, not a discount. total_incl
-- and the VAT snapshot do not move — a points payment behaves exactly like a
-- card payment in that respect, so a customer can put points against a
-- service that rule 1 says is never discounted. The taxable base is untouched;
-- only how the bill gets settled changes.
--
-- That is also why points need their own branch AHEAD of record_payment's
-- existing else-branch. That branch demands p_external_ref for every non-cash
-- method — right for card, Juice and a bank transfer, where someone else's
-- system (the terminal slip, the bank statement) is the source of truth being
-- cited. Points have no outside system to cite: the ledger row this branch
-- writes (via app.spend_points) IS the reference. Falling through to the
-- generic else-branch would either demand a meaningless external_ref for
-- every points payment or require teaching that branch a points exception —
-- a dedicated branch ahead of it is the smaller, clearer change.
--
-- A points payment still has to land on an open till. The till gate
-- (20260716000040) exists because a payment booked to no session appears on
-- no Z-report ever — the day's totals would include the ticket while the
-- means-of-payment split silently lost the money. Points are a real
-- settlement the shop must be able to see on the cash-up like any other
-- tender, so they get no exemption from that gate; only CASH additionally
-- moves a physical drawer, but every method — points included — still needs
-- an open service to belong to.
--
-- The "non-cash needs something to point at" rule turned out to be enforced
-- TWICE: once in record_payment's else-branch (worked around by the new
-- branch below) and independently again by the payments table's own
-- payments_check3 CHECK constraint, which knew about a reversal's
-- reverses_payment_id as an alternative to external_ref but not about
-- points. That second enforcement is not visible in either function body —
-- it only surfaced by actually inserting a points payment and reading the
-- constraint violation — so this migration widens it too.
--
-- Spliced into record_payment via pg_get_functiondef + replace(), not
-- retyped — this function has already been rebuilt several times today (most
-- recently to earn points on full settlement, 20260811000030), and the live
-- body is the only trustworthy description of it; the migration files that
-- built it up are history, not documentation. The anchor below is verified
-- against what is actually installed before it is touched, and the guard
-- afterward proves the splice did not cost record_payment anything it had.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.spend_points(p_invoice uuid, p_amount numeric) returns void
language plpgsql set search_path = public, pg_temp as $$
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
    (tenant_id, customer_id, delta, reason, ref_type, ref_id, created_by)
  values
    (v_doc.tenant_id, v_doc.customer_id, -v_needed, 'redeemed', 'document', p_invoice,
     app.current_app_user_id());
end $$;

-- ── the payments TABLE independently repeats the rule the function enforced ──
-- payments_check3 predates points: `method = 'cash' OR reverses_payment_id IS
-- NOT NULL OR external_ref IS NOT NULL` — it already carves out an exception
-- for a reversal (traceable via reverses_payment_id) on top of cash, but it
-- does not know 'points' is now a second way to pay with nothing external to
-- cite. Without this, every points payment record_payment tries to insert is
-- rejected by the table itself with "violates check constraint
-- payments_check3", regardless of how correct the function-level logic above
-- is — found by actually running a payment through, not by reading either
-- function body. Widening an existing CHECK can never invalidate a row that
-- already satisfied it, so this is safe to run against the live table as-is.
alter table public.payments drop constraint if exists payments_check3;
alter table public.payments add constraint payments_check3
  check (method = 'cash' or reverses_payment_id is not null or external_ref is not null or method = 'points');

-- ── splice the spend call into record_payment, ahead of the external-ref branch ──
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_payment';
  if v_def is null then raise exception 'public.record_payment not found'; end if;
  if position('spend_points' in v_def) > 0 then return; end if;

  if position('if p_method = ''cash'' then' in v_def) = 0 then
    raise exception 'record_payment: the cash-branch anchor was not found — repair it before splicing onto it';
  end if;

  v_def := replace(
    v_def,
    'if p_method = ''cash'' then',
    'if p_method = ''points'' then
    -- The ledger row IS the reference; the else-branch below wants an external
    -- one, which only makes sense for card, Juice and a bank transfer.
    perform app.spend_points(p_invoice_id, p_amount);
    p_tendered := null; v_change := null;
  elsif p_method = ''cash'' then'
  );

  execute v_def;
end $$;

-- ── prove it against what is actually installed ─────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_payment';

  if position('spend_points' in v_def) = 0 then
    raise exception 'record_payment never learned to spend points';
  end if;
  -- The splice must not have cost the function the earning splice next to it...
  if position('award_points_for_invoice' in v_def) = 0 then
    raise exception 'record_payment lost its points-earning splice while learning to spend them';
  end if;
  -- ...or the delivery branch further down.
  if position('job_delivered' in v_def) = 0 then
    raise exception 'record_payment lost its delivery branch while learning to spend points';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.payments'::regclass and conname = 'payments_check3'
       and position('points' in pg_get_constraintdef(oid)) > 0
  ) then
    raise exception 'payments_check3 still does not know about the points method';
  end if;
end $$;
