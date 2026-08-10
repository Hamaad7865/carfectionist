-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a settled bill earns its points.
--
-- Earning follows the SALE, not what happened to be on it: the owner's call on
-- 2026-08-10 is one flat rate against total_incl rather than a rate that varies
-- by category — so a cashier can answer "how many points is that?" off the
-- total already on the screen, no line-by-line lookup required. total_incl is
-- already net of every discount, so a discounted sale earns on what the
-- customer actually paid, not the sticker price.
--
-- It fires on FULL settlement, not on every part-payment. record_payment already
-- computes v_paid and compares it to v_doc.total_incl to decide 'paid' vs
-- 'partly_paid' a few lines above where this splices in — award_points_for_invoice
-- is called from that same instant, once the bill has just become fully paid.
-- Flooring three instalments separately would lose points to rounding up to
-- three times over instead of once, for no reason the customer caused.
--
-- The share settled WITH points earns nothing. Spending points is a tender
-- (20260811000010) that leaves total_incl untouched, so without this exclusion
-- a customer could pay with points and earn a fraction of them straight back —
-- a balance that tops itself up and never actually goes down. This function
-- nets out whatever this invoice already collected under the 'points' method
-- before it floors, so only the rupee share earns anything.
--
-- Idempotence is the unique partial index from 20260811000020
-- (idx_points_ledger_one_earn_per_doc), not a lookup-then-insert here. The
-- payment that finally settles a bill can be retried by a flaky terminal, and
-- an offline sale can replay its closing payment after reconnecting — both
-- must land on the SAME earn row. `on conflict do nothing` makes a second
-- attempt a no-op instead of a race that double-credits: the index is the
-- arbiter of "has this invoice already earned", not this function's judgement.
--
-- Spliced into record_payment via pg_get_functiondef + replace(), not retyped —
-- this function is long and has already been rebuilt many times; retyping it
-- from an older text is exactly how a live fix got silently reverted once
-- (20260810000015) and how the replay-ordering fix nearly went with it
-- (20260802000010, 20260810000050). The guard below refuses to run twice and
-- asserts afterward that the delivery branch (job_delivered) is still there.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.award_points_for_invoice(p_invoice uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  v_doc      public.documents;
  v_rate     numeric;
  v_points   numeric;
  v_pts_paid numeric;
begin
  select * into v_doc from public.documents where id = p_invoice;
  if not found or v_doc.customer_id is null then return; end if;
  if v_doc.total_incl <= 0 then return; end if;

  select points_per_100 into v_rate from public.business_settings where id = v_doc.tenant_id;
  if coalesce(v_rate, 0) <= 0 then return; end if;

  select coalesce(sum(amount), 0) into v_pts_paid
    from public.payments where document_id = p_invoice and method = 'points';

  v_points := floor(greatest(v_doc.total_incl - v_pts_paid, 0) / 100.0 * v_rate);
  if v_points < 1 then return; end if;

  -- The unique index is the arbiter, not a lookup-then-insert: an offline sale
  -- replaying and a retried part payment both arrive here, and a race between
  -- two of them would otherwise double-credit.
  insert into public.customer_points_ledger
    (tenant_id, customer_id, delta, reason, ref_type, ref_id, created_by)
  values
    (v_doc.tenant_id, v_doc.customer_id, v_points::int, 'earned', 'document', p_invoice,
     app.current_app_user_id())
  on conflict do nothing;
end $$;

-- ── splice the earn call into record_payment ─────────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_payment';
  if v_def is null then raise exception 'public.record_payment not found'; end if;
  if position('award_points_for_invoice' in v_def) > 0 then return; end if;

  if position('if v_paid >= v_doc.total_incl and v_doc.job_id is not null then' in v_def) = 0 then
    raise exception 'record_payment: the delivery-branch anchor was not found — repair it before splicing onto it';
  end if;

  v_def := replace(
    v_def,
    'if v_paid >= v_doc.total_incl and v_doc.job_id is not null then',
    '-- Settled in full: the sale earns its points, once. See 20260811000030.
  if v_paid >= v_doc.total_incl then
    perform app.award_points_for_invoice(p_invoice_id);
  end if;

  if v_paid >= v_doc.total_incl and v_doc.job_id is not null then'
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

  if position('award_points_for_invoice' in v_def) = 0 then
    raise exception 'record_payment never learned to award points';
  end if;
  -- The splice must not have cost the function its delivery branch.
  if position('job_delivered' in v_def) = 0 then
    raise exception 'record_payment lost its delivery branch while learning to award points';
  end if;
end $$;
