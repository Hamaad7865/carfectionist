-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — reverse_payment gets back what a replay took from it.
--
-- WHAT WAS FOUND (read back from production on 2026-10-12). The installed
-- reverse_payment is the 20260714000003 (till_integrity) body with the two
-- August splices on top — the owner gate and the points unwind. Three later
-- changes the history says are there, are not:
--
--   1. 20260715000010 — lock the document BEFORE summing its payments. Without
--      it a payment and a reversal landing together on one invoice can each
--      compute amount_paid from a stale sum, and the last writer wins.
--   2. 20260716000030 — money walked back un-delivers the job that money
--      delivered. Without it, reversing the payment that handed a car over
--      leaves the job 'delivered' against a bill that is open again.
--   3. 20260716000050 — a credit-noted invoice's payments cannot be reversed.
--      The credit note's own mirrors cover every payment it refunded ("payment
--      already reversed"); this guard covers the ones it did not.
--
-- HOW IT WAS LOST. Not by anyone editing the function. On 2026-09-10 the
-- migration history was repaired (commit 2ea4c63): 13 version stamps that two
-- files had shared were folded into one file each, and `db push --include-all`
-- was run. The tracker held no row for those 13 versions, so the CLI took them
-- for new and EXECUTED them — July files, against September's database.
-- 20260714000003 re-installed its own reverse_payment: its tracker row and the
-- two functions it is the last file to define (close_cash_session,
-- app.forbid_closed_session_write) all carry transaction id 442294. The three
-- files listed above had been marked applied in bulk — 61 tracker rows written
-- by a single transaction, straight after the stray push of 2026-08-10 — so the
-- CLI skipped them and nothing put their changes back. 20260810000060 and
-- 20260811000050 were still pending; each found its marker gone and spliced
-- itself onto the stale body — which is why the owner gate and the points
-- unwind are present and the rest is not.
--
-- (A tracker row says a version is recorded. It does not say the file ran, or
-- that what it installed is still installed. Read pg_get_functiondef.)
--
-- It is the 2026-08-10 accident (20260810000015) a second time, by the same
-- mechanism: Postgres keeps one version of a function, not a history, so
-- re-running an old file is a revert.
--
-- SPLICED, NOT RETYPED. The live body is read with pg_get_functiondef and three
-- pieces are put back with replace(), each behind a marker check (so running
-- this file twice is a no-op — a re-runnable file that is NOT idempotent is
-- exactly what did the damage) and an anchor that must match exactly once (so a
-- body that has changed shape stops the migration instead of being guessed at).
--
-- ONE DELIBERATE DEPARTURE from the July text. The July walk-back un-delivered
-- documents.job_id — the single job a bill named. Since 20260906000010 a bill
-- can cover several cars, and record_payment hands back every one of them
-- through app.invoice_jobs(). A walk-back that knew only job_id would return
-- car one to READY and leave cars two and three delivered against the same
-- unsettled bill. So it walks the same set record_payment delivers, with the
-- same discriminator the July block used: only a job this payment delivered
-- (delivered_at = the payment's received_at, both stamped by one now()).
--
-- The new audit insert sits ten spaces deep. 20260811000050 anchors on the
-- two-space `insert into public.audit_events`; that anchor still matches once,
-- and the proof block below says so.
-- ═══════════════════════════════════════════════════════════════════════════

do $do$
declare
  v_oid  oid;
  v_n    int;
  v_def  text;
  v_was  text;
  v_acl  text;

  -- 3) 20260716000050, verbatim. Goes straight after the "already reversed" check.
  v_cn_anchor text := E'    raise exception ''payment already reversed'';\n  end if;\n';
  v_cn_guard  text := $cn$  -- A credit-noted invoice's money was already walked back by the refund — flipping
  -- the invoice open again here would make it collectable a second time.
  if exists (
    select 1 from public.documents cn
     where cn.tenant_id = v_tenant and cn.doc_type = 'credit_note'
       and cn.source_document_id = v_orig.document_id and cn.status <> 'void'
  ) then
    raise exception 'this invoice has a credit note — the refund already reversed its money';
  end if;
$cn$;

  -- 1) 20260715000010, verbatim. Replaces the unlocked read that follows the sum.
  v_lock_anchor text := E'  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = v_orig.document_id;\n'
                     || E'  select * into v_doc from public.documents where id = v_orig.document_id;\n';
  v_lock_fix    text := $lock$  -- Lock the document BEFORE summing so a concurrent record_payment/reverse_payment on
  -- the same invoice cannot lose an update to amount_paid/status (audit finding #1).
  select * into v_doc from public.documents where id = v_orig.document_id for update;
  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = v_orig.document_id;
$lock$;

  -- 2) 20260716000030's walk-back, over every car the bill covers. Goes between the
  --    status recompute and the NOTE about the old expected_cash arithmetic, where
  --    the July block sat. A nested block, so the function's own DECLARE is untouched.
  v_walk_anchor text := E'  -- NOTE: the old version updated the ORIGINAL session''s expected_cash and variance\n';
  v_walk_back   text := $walk$  -- Money walked back: a job auto-delivered by THIS payment must not stay
  -- "delivered" against a bill no longer settled. The discriminator is the
  -- transaction timestamp — record_payment stamps delivered_at and the payment's
  -- received_at from the same now(), so equality means this payment caused the
  -- delivery. A car that left on account or was collected after prepaying keeps
  -- its delivery: that handover happened at the kerb, not in this ledger.
  -- EVERY car on the bill, not just the one documents.job_id happens to name —
  -- the same set record_payment hands back (app.invoice_jobs, 20260906000010).
  -- (The RPC is owner/manager-only, which jobs_guard requires for un-delivering.)
  if v_paid < v_doc.total_incl then
    declare
      v_job_id uuid;
    begin
      for v_job_id in select ij.job_id from app.invoice_jobs(v_orig.document_id) ij loop
        update public.jobs
           set status = 'ready', delivered_at = null
         where id = v_job_id and tenant_id = v_tenant and status = 'delivered'
           and delivered_at = v_orig.received_at;
        if found then
          insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
          values (v_tenant, v_actor, 'job_delivery_reversed', 'job', v_job_id,
                  jsonb_build_object('reason', trim(p_reason), 'invoice', v_doc.number));
        end if;
      end loop;
    end;
  end if;

$walk$;
begin
  -- A checkout that turned LF into CRLF must not turn a matching anchor into a miss.
  v_cn_guard  := replace(v_cn_guard,  E'\r', '');
  v_lock_fix  := replace(v_lock_fix,  E'\r', '');
  v_walk_back := replace(v_walk_back, E'\r', '');

  -- One function, or none of what follows is safe: `select into` would silently
  -- take whichever overload came first and splice onto that one.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reverse_payment';
  if v_n <> 1 then
    raise exception 'reverse_payment has % definitions, not 1 — resolve the overloads before splicing', v_n;
  end if;

  select p.oid, pg_get_functiondef(p.oid), p.proacl::text into v_oid, v_def, v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reverse_payment';
  if position(E'\r' in v_def) > 0 then
    raise exception 'reverse_payment: the installed body has CRLF line endings — the anchors below assume LF';
  end if;
  if to_regprocedure('app.invoice_jobs(uuid)') is null then
    raise exception 'app.invoice_jobs(uuid) is missing — 20260906000010 has to be in place first';
  end if;
  v_was := v_def;

  -- ── 3. the credit-note guard ──────────────────────────────────────────────
  if position('this invoice has a credit note' in v_def) = 0 then
    v_n := (length(v_def) - length(replace(v_def, v_cn_anchor, ''))) / length(v_cn_anchor);
    if v_n <> 1 then
      raise exception 'reverse_payment: the "already reversed" anchor matches % times, not 1 — the credit-note guard was NOT installed', v_n;
    end if;
    v_def := replace(v_def, v_cn_anchor, v_cn_anchor || v_cn_guard);
  end if;

  -- ── 1. the document lock ──────────────────────────────────────────────────
  if position('where id = v_orig.document_id for update;' in v_def) = 0 then
    v_n := (length(v_def) - length(replace(v_def, v_lock_anchor, ''))) / length(v_lock_anchor);
    if v_n <> 1 then
      raise exception 'reverse_payment: the sum-then-read anchor matches % times, not 1 — the document lock was NOT installed', v_n;
    end if;
    v_def := replace(v_def, v_lock_anchor, v_lock_fix);
  end if;

  -- ── 2. the delivery walk-back ─────────────────────────────────────────────
  if position('job_delivery_reversed' in v_def) = 0 then
    v_n := (length(v_def) - length(replace(v_def, v_walk_anchor, ''))) / length(v_walk_anchor);
    if v_n <> 1 then
      raise exception 'reverse_payment: the NOTE anchor matches % times, not 1 — the delivery walk-back was NOT installed', v_n;
    end if;
    v_def := replace(v_def, v_walk_anchor, v_walk_back || v_walk_anchor);
  end if;

  if v_def is distinct from v_was then
    execute v_def;
  end if;

  -- create-or-replace keeps the grants; say so rather than assume it.
  if (select p.proacl::text from pg_proc p where p.oid = v_oid) is distinct from v_acl then
    raise exception 'reverse_payment: the splice changed who may execute the function';
  end if;
end $do$;

-- ── prove it against what is actually installed ─────────────────────────────
do $$
declare
  v_def  text;
  v_n    int;
  v_lock int;
  v_sum  int;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reverse_payment';
  if v_n <> 1 then
    raise exception 'reverse_payment has % definitions — a stale overload is live', v_n;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reverse_payment';

  -- The three pieces this file exists for.
  if position('this invoice has a credit note — the refund already reversed its money' in v_def) = 0 then
    raise exception 'reverse_payment still has no credit-note guard';
  end if;
  if position('app.invoice_jobs(v_orig.document_id)' in v_def) = 0
     or position('delivered_at = v_orig.received_at' in v_def) = 0
     or position('job_delivery_reversed' in v_def) = 0 then
    raise exception 'reverse_payment still does not walk a delivery back';
  end if;
  v_lock := position('from public.documents where id = v_orig.document_id for update;' in v_def);
  v_sum  := position('select coalesce(sum(amount), 0) into v_paid' in v_def);
  if v_lock = 0 or v_sum = 0 or v_lock > v_sum then
    raise exception 'reverse_payment still sums the payments before it locks the document';
  end if;
  if position(E'from public.documents where id = v_orig.document_id;\n' in v_def) > 0 then
    raise exception 'reverse_payment still reads the document without locking it';
  end if;

  -- And nothing the function already had was lost putting them back.
  if position('require_owner_or_override(''payment'', p_payment_id)' in v_def) = 0 then
    raise exception 'reverse_payment lost the owner gate while regaining its guards';
  end if;
  if position('a reason is required to reverse a payment' in v_def) = 0 then
    raise exception 'reverse_payment lost its reason guard while regaining its guards';
  end if;
  if position('app.unwind_points_for_payment(v_orig.id)' in v_def) = 0 then
    raise exception 'reverse_payment lost the points unwind while regaining its guards';
  end if;
  if position('payment already reversed' in v_def) = 0
     or position('a cash refund needs an open till' in v_def) = 0
     or position('booked_session_id' in v_def) = 0 then
    raise exception 'reverse_payment lost a till-integrity guard while regaining its guards';
  end if;

  -- The next splice written against the closing audit insert must still find it once.
  v_n := (length(v_def) - length(replace(v_def, E'\n  insert into public.audit_events', '')))
         / length(E'\n  insert into public.audit_events');
  if v_n <> 1 then
    raise exception 'reverse_payment: the closing audit insert now matches % times, not 1', v_n;
  end if;
end $$;
