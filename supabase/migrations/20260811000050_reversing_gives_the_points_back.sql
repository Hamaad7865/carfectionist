-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — reversing gives the points back.
--
-- Two directions, both needed:
--   1. reversing a POINTS payment gives those points back — the customer
--      no longer spent them, so the balance should say so.
--   2. reversing ANY payment that drops a bill below settled takes back what
--      that settlement earned. Without this, pay in full (earn points),
--      reverse the payment, pay again (earn points again) is a points
--      printer — free balance for typing the same payment twice.
--
-- The ledger is append-only (trg_points_ledger_immutable, 20260811000020) —
-- an unwind cannot delete or edit the original row, so it is a compensating
-- 'reversed' row instead. The history keeps saying what happened (points were
-- earned, then separately given back), which is the entire point of a ledger:
-- a balance you can recompute from scratch and trust, not a number someone
-- quietly patched.
--
-- Both directions are idempotent by construction, not by locking: direction 1
-- checks for an existing 'reversed' row keyed to THIS payment before it
-- inserts; direction 2 checks for an existing 'reversed' row keyed to the
-- DOCUMENT before it inserts. A retried or duplicated call is a no-op, the
-- same shape as award_points_for_invoice's own idempotence.
--
-- Spliced into reverse_payment via pg_get_functiondef + replace(), not
-- retyped, for the same reason as every other splice today: the live body is
-- the only trustworthy source, and this function alone has been rebuilt by
-- seven-plus migrations (20260810000060's banner already counted seven before
-- today's points work).
--
-- The anchor is `insert into public.audit_events`, and the call goes BEFORE
-- it so the "is it still settled?" question in unwind_points_for_payment
-- reads the state THIS reversal just created — amount_paid and status are
-- updated well before either audit insert, so by the time either runs the
-- picture is already final.
--
-- That anchor is no longer unique, and this migration checks for that instead
-- of assuming it: reverse_payment now writes AUDIT_EVENTS TWICE — once
-- conditionally, six-space indented, inside the branch that walks back a
-- job's auto-delivery ('job_delivery_reversed'), and once unconditionally,
-- two-space indented, as the function's closing act ('payment_reversed').
-- Postgres' replace() rewrites every match it finds, not just the first, so
-- searching on the bare phrase would plant the points call a second time
-- inside the job-only branch — and worse, MISS the unconditional path being
-- covered at all for any reversal with no job on the bill, which is most of
-- them. The guard below counts matches on a whitespace-qualified anchor
-- (newline + two-space indent, which only the unconditional insert has) and
-- refuses to run if that count is not exactly 1, rather than trusting the
-- single position this function held when an earlier draft of this plan was
-- written against it.
-- ═══════════════════════════════════════════════════════════════════════════

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

  -- 1. a reversed points payment returns exactly what it took
  if v_pay.method = 'points' then
    select coalesce(-sum(delta), 0) into v_spent
      from public.customer_points_ledger
     where ref_type = 'document' and ref_id = v_doc.id and reason = 'redeemed';
    if v_spent > 0 and not exists (
      select 1 from public.customer_points_ledger
       where ref_type = 'payment' and ref_id = p_payment and reason = 'reversed'
    ) then
      insert into public.customer_points_ledger
        (tenant_id, customer_id, delta, reason, ref_type, ref_id, note, created_by)
      values (v_doc.tenant_id, v_doc.customer_id, v_spent, 'reversed', 'payment', p_payment,
              'points returned on a reversed payment', app.current_app_user_id());
    end if;
  end if;

  -- 2. a bill that is no longer settled un-earns
  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = v_doc.id;
  if v_paid < v_doc.total_incl then
    select coalesce(sum(delta), 0) into v_earned
      from public.customer_points_ledger
     where ref_type = 'document' and ref_id = v_doc.id and reason = 'earned';
    if v_earned > 0 and not exists (
      select 1 from public.customer_points_ledger
       where ref_type = 'document' and ref_id = v_doc.id and reason = 'reversed'
    ) then
      insert into public.customer_points_ledger
        (tenant_id, customer_id, delta, reason, ref_type, ref_id, note, created_by)
      values (v_doc.tenant_id, v_doc.customer_id, -v_earned, 'reversed', 'document', v_doc.id,
              'the bill is no longer settled in full', app.current_app_user_id());
    end if;
  end if;
end $$;

-- ── splice the unwind call into reverse_payment, ahead of the audit trail ────
do $$
declare
  v_def    text;
  -- Newline + two-space indent picks out only the FINAL, unconditional
  -- `insert into public.audit_events` (the 'payment_reversed' one) — the
  -- other occurrence is six-space indented, inside the job-delivery branch.
  -- See the banner above.
  v_anchor text := '
  insert into public.audit_events';
  v_count  int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reverse_payment';
  if v_def is null then raise exception 'public.reverse_payment not found'; end if;
  if position('unwind_points_for_payment' in v_def) > 0 then return; end if;

  v_count := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_count = 0 then
    raise exception 'reverse_payment: the audit-insert anchor was not found — repair it before splicing onto it';
  end if;
  if v_count > 1 then
    raise exception
      'reverse_payment: the audit-insert anchor matches % times, not 1 — reverse_payment changed shape; disambiguate before splicing',
      v_count;
  end if;

  v_def := replace(
    v_def,
    v_anchor,
    '
  -- Give back what this payment did to the points. See 20260811000050.
  perform app.unwind_points_for_payment(v_orig.id);

  insert into public.audit_events'
  );

  execute v_def;
end $$;

-- ── prove it against what is actually installed ─────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reverse_payment';

  if position('unwind_points_for_payment' in v_def) = 0 then
    raise exception 'reverse_payment never learned to unwind points';
  end if;
  -- The splice must not have cost reverse_payment the owner gate (rule 3)...
  if position('require_owner_or_override' in v_def) = 0 then
    raise exception 'reverse_payment lost the owner gate while learning to unwind points';
  end if;
  -- ...or its reason guard.
  if position('a reason is required to reverse a payment' in v_def) = 0 then
    raise exception 'reverse_payment lost its reason guard while learning to unwind points';
  end if;
end $$;
