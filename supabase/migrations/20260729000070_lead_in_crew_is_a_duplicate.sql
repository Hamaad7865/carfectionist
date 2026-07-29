-- ═══════════════════════════════════════════════════════════════════════════
-- Say "already on this job" in the one dialect every client already understands.
--
-- 20260729000030 added a trigger refusing the lead being added to their own
-- crew. It raised a plain exception (SQLSTATE P0001), and that is the wrong
-- shape for the tablet's outbox: a queued crew-add that the trigger refuses
-- looks like a transient failure, so the outbox retries it — and because ops
-- drain in strict FIFO order to preserve their sequence, every other pending
-- write on that device (other jobs' checklists, reassignments) waits behind it
-- through all five attempts before it is finally dead-lettered. Staff see
-- minutes of unexplained sync lag with nothing on screen to explain it.
--
-- It can genuinely happen: one tablet sets someone as lead while another,
-- offline, has already queued "add that same person to the crew".
--
-- The refusal is not really an error, it is a statement that the outcome is
-- already true — the person IS on the job, in the lead seat. That is precisely
-- what unique_violation means, and both clients already treat 23505 as
-- "already landed" (OutboxRepository.isDuplicateKey, and the same rule the
-- audit-event insert relies on). So raise it as one.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.forbid_lead_in_crew() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lead uuid;
begin
  select technician_id into v_lead from public.jobs where id = new.job_id;
  if v_lead is not null and v_lead = new.app_user_id then
    raise exception 'this technician already leads the job — the lead is not also crew'
      using errcode = '23505';
  end if;
  return new;
end $$;
