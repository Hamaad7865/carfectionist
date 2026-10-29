-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a job paid before anyone tapped "Mark ready" can still be
-- handed back, in one step
--
-- Found live (JOB-49B3, 27 Oct 2026). The customer came back for the car, asked
-- for a perfume on the bill, and the cashier did exactly what the board offers
-- an in-progress job: "Add to bill" → add the Card Ventist → issue and take
-- payment. INV-0457 was settled in full on the spot and the car drove away.
--
-- record_payment only hands back a READY job — on purpose: a prepaid car still
-- in the bay must not read as delivered (_verify-collection-lifecycle.mjs holds
-- that). Nobody had marked this one ready, so it stayed "in progress" with its
-- money in the drawer, and the board's only offer was "Mark ready (0/4
-- checklist)" — which said nothing about the bill being paid, and staff would
-- not press it for fear of raising a second bill.
--
-- The two-tap path did exist (Mark ready, then "Car collected — mark
-- delivered") but nothing pointed at it. The boards now show the paid bill on
-- an in-progress job and offer the handover directly; this is the RPC behind
-- that button. It finishes the job and hands it back in ONE transaction — if
-- the bill check refuses, the step to ready rolls back with it, so a car is
-- never left half-finished by a refused handover.
--
-- deliver_paid_job is NOT loosened: it still refuses an in-progress job, and
-- every bill check (each live bill settled, at least one paid, drafts named)
-- stays in exactly one place — this function delegates to it.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.hand_back_paid_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_job    public.jobs;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_job from public.jobs
   where id = p_job_id and tenant_id = v_tenant for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status = 'delivered' then return false; end if; -- double tap: no-op
  if v_job.status not in ('in_progress', 'ready') then
    raise exception 'job cannot be handed back (status %)', v_job.status;
  end if;

  -- The work is done: the step complete_job takes, without consumption (none is
  -- recorded from the board's handover; the bill already moved what it sold).
  -- An open pause is folded first so time-on-job stops at the pause, the same
  -- as the tablet's markReady does before it calls complete_job.
  if v_job.status = 'in_progress' then
    update public.jobs
       set status    = 'ready',
           ready_at  = now(),
           paused_ms = paused_ms + case when paused_at is null then 0
                         else greatest(0, (extract(epoch from now() - paused_at) * 1000)::bigint) end,
           paused_at = null
     where id = p_job_id;
  end if;

  -- The handover, and every check on the bill, is deliver_paid_job's.
  return public.deliver_paid_job(p_job_id);
end $$;

comment on function public.hand_back_paid_job(uuid) is
  'Car collected on a bill already paid in full: finishes an in-progress job and '
  'delivers it in one transaction. Bill checks are deliver_paid_job''s.';

-- Default privileges hand EXECUTE to anon by name; revoking "public" alone leaves it.
revoke all on function public.hand_back_paid_job(uuid) from public;
revoke all on function public.hand_back_paid_job(uuid) from anon;
grant execute on function public.hand_back_paid_job(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.hand_back_paid_job(uuid)', 'execute') then
    raise exception 'hand_back_paid_job is still executable by anon';
  end if;
end $$;
