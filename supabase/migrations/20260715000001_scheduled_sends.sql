-- Scheduled document delivery: "Schedule for later" (a one-off deferred send)
-- and "Auto Reminders" (unpaid-invoice chasers). A pg_cron job POSTs to
-- /api/cron/run every few minutes; that endpoint atomically claims due rows and
-- dispatches each through the SAME send path as an immediate send, so a
-- scheduled send is byte-for-byte identical to a manual one.
--
-- Idempotent (CREATE ... IF NOT EXISTS / OR REPLACE) so it is safe to re-run.

create table if not exists scheduled_sends (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references business_settings(id),
  document_id    uuid not null references documents(id) on delete cascade,
  channel        text not null check (channel in ('email','whatsapp')),
  to_addr        text not null,
  note           text,
  kind           text not null default 'send' check (kind in ('send','reminder')),
  scheduled_at   timestamptz not null,
  only_if_unpaid boolean not null default false,   -- reminders skip themselves once paid
  status         text not null default 'pending'
                   check (status in ('pending','sending','sent','failed','skipped','cancelled')),
  attempts       int not null default 0,
  last_error     text,
  created_by     uuid references app_users(id),
  created_at     timestamptz not null default now(),
  claimed_at     timestamptz,   -- when a processor last picked it up (crash recovery)
  processed_at   timestamptz
);

create index if not exists idx_sched_due on scheduled_sends (scheduled_at) where status = 'pending';
create index if not exists idx_sched_doc on scheduled_sends (document_id);

alter table scheduled_sends enable row level security;

-- Tenant members see and create their tenant's rows; cancels go through the
-- definer RPC below; the cron processor uses the service role (bypasses RLS).
drop policy if exists sched_select on scheduled_sends;
create policy sched_select on scheduled_sends for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

drop policy if exists sched_insert on scheduled_sends;
create policy sched_insert on scheduled_sends for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and status = 'pending');

-- Atomic claim: flip up to N *due* rows to 'sending' and return them. FOR UPDATE
-- SKIP LOCKED means two overlapping cron runs can never grab the same row, so a
-- scheduled send is dispatched exactly once even if a run is slow.
create or replace function public.claim_due_scheduled_sends(p_limit int default 50)
returns setof scheduled_sends
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Crash recovery: a row stuck in 'sending' means a processor died mid-send.
  -- After 15 minutes, give up on it if it has already burned 5 attempts,
  -- otherwise return it to the queue for another try.
  update scheduled_sends
     set status = 'failed', last_error = 'gave up after repeated attempts', processed_at = now()
   where status = 'sending' and claimed_at < now() - interval '15 minutes' and attempts >= 5;
  update scheduled_sends
     set status = 'pending'
   where status = 'sending' and claimed_at < now() - interval '15 minutes' and attempts < 5;

  return query
  update scheduled_sends s
     set status = 'sending', attempts = attempts + 1, claimed_at = now()
   where s.id in (
     select id from scheduled_sends
      where status = 'pending' and scheduled_at <= now()
      order by scheduled_at
      limit greatest(1, least(p_limit, 200))
      for update skip locked
   )
  returning s.*;
end $$;
revoke execute on function public.claim_due_scheduled_sends(int) from public, anon, authenticated;
grant execute on function public.claim_due_scheduled_sends(int) to service_role;

-- The processor reports each row's outcome back.
create or replace function public.finish_scheduled_send(p_id uuid, p_status text, p_error text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('sent','failed','skipped','pending') then
    raise exception 'bad status %', p_status;
  end if;
  update scheduled_sends
     set status = p_status,
         last_error = p_error,
         processed_at = case when p_status = 'pending' then null else now() end
   where id = p_id;
end $$;
revoke execute on function public.finish_scheduled_send(uuid, text, text) from public, anon, authenticated;
grant execute on function public.finish_scheduled_send(uuid, text, text) to service_role;

-- Operators cancel a still-pending scheduled send (only their own tenant's).
create or replace function public.cancel_scheduled_send(p_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update scheduled_sends
     set status = 'cancelled'
   where id = p_id
     and tenant_id = app.current_tenant_id()
     and status = 'pending';
end $$;
revoke execute on function public.cancel_scheduled_send(uuid) from public, anon;
grant execute on function public.cancel_scheduled_send(uuid) to authenticated;
