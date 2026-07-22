-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a cancelled job records WHEN and WHY, on the job row
--
-- cancel_job demands a reason and then files it only in the job_cancelled audit
-- event, so every screen that wanted to say why had to go digging — and the
-- tablet, which never reads audits, could not say at all. A cancellation is a
-- lifecycle fact about the job, exactly like ready_at and delivered_at, so it
-- belongs beside them (and mirrors documents.void_reason).
--
-- It also fixes a live clock bug. jobClock ends at ready_at ?? delivered_at ??
-- NOW, and a cancelled job has neither — so its timer kept climbing forever
-- (a job cancelled yesterday afternoon was still showing 16:55:00 this
-- morning). cancelled_at gives the clock its end marker on both apps.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.jobs
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

comment on column public.jobs.cancelled_at is
  'When the car was dropped. Also the clock''s end marker — without it a cancelled job accrues time forever.';
comment on column public.jobs.cancel_reason is
  'Why it was dropped (cancel_job requires one). Mirrors documents.void_reason.';

-- Backfill from the audit trail, which has carried both all along.
update public.jobs j
   set cancelled_at  = coalesce(j.cancelled_at, a.created_at),
       cancel_reason = coalesce(j.cancel_reason, nullif(btrim(a.payload->>'reason'), ''))
  from (
    select distinct on (ref_id) ref_id, created_at, payload
      from public.audit_events
     where event_type = 'job_cancelled' and ref_type = 'job'
     order by ref_id, created_at desc
  ) a
 where a.ref_id = j.id
   and j.status = 'cancelled'
   and (j.cancelled_at is null or j.cancel_reason is null);

-- A cancelled job with no audit row at all (shouldn't exist, but the clock must
-- never run away): fall back to when the row was last touched.
update public.jobs
   set cancelled_at = updated_at
 where status = 'cancelled' and cancelled_at is null;

-- ── cancel_job now stamps them ──────────────────────────────────────────────
-- Patched from the LIVE definition so the rest of the function — the bill
-- resolution, the guards, the audit event — cannot drift from what is running.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cancel_job';
  if v_def is null then raise exception 'public.cancel_job not found'; end if;

  if position('cancel_reason' in v_def) = 0 then
    v_def := replace(
      v_def,
      'update public.jobs set status = ''cancelled'' where id = p_job_id returning * into v_job;',
      'update public.jobs set status = ''cancelled'', cancelled_at = now(), cancel_reason = trim(p_reason)'
      || ' where id = p_job_id returning * into v_job;'
    );
    if position('cancel_reason' in v_def) = 0 then
      raise exception 'could not patch cancel_job — the update statement moved';
    end if;
    execute v_def;
  end if;
end $$;
