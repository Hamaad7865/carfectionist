-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — Cashmag-parity till closing
--
-- Three grains, exactly like the owner's till:
--   DAY     (trading_days)   — Tuesday 14 July. Closing it is FINAL: no more money.
--   SERVICE (cash_sessions)  — "Service 1/2/3". One open per device. Already exists.
--   TICKET  (documents)      — an invoice rung on a service.
--
-- And ONE report function, app.z_totals(), which both the tablet and the back office
-- call. A Z report is computed once, frozen into z_reports.totals, and reprinted from
-- that frozen json for ever after — so a slip reprinted next month is the slip that
-- came out of the printer today, even though the underlying rows have moved on (an
-- on-account invoice gets settled, a job gets delivered).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The trading day ─────────────────────────────────────────────────────────
create table if not exists public.trading_days (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.business_settings(id) on delete cascade,
  business_date  date not null,
  status         text not null default 'open' check (status in ('open','closed')),
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz,
  closed_by      uuid references public.app_users(id),
  reopened_count int not null default 0,
  unique (tenant_id, business_date)
);
alter table public.trading_days enable row level security;
drop policy if exists td_select on public.trading_days;
create policy td_select on public.trading_days for select to authenticated
  using (tenant_id = app.current_tenant_id());
grant select on public.trading_days to authenticated;

-- A service belongs to a day and is numbered within it ("Service 3").
alter table public.cash_sessions add column if not exists trading_day_id uuid references public.trading_days(id);
alter table public.cash_sessions add column if not exists service_no int;

-- ── Per-method float accumulation + the bank ────────────────────────────────
-- The "CASH FLOAT ACCUMULATION" column on the owner's screen: what has piled up in
-- each method and has NOT been remitted. It chains from service to service on the
-- same device: this service's float_out is the next service's float_in.
create table if not exists public.cash_session_methods (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.business_settings(id) on delete cascade,
  cash_session_id uuid not null references public.cash_sessions(id) on delete cascade,
  method          text not null,
  float_in        numeric(12,2) not null default 0,  -- carried in from the last service
  takings         numeric(12,2) not null default 0,  -- taken in this service (net of refunds)
  counted         numeric(12,2),                     -- cash only: what was actually in the drawer
  remitted        numeric(12,2) not null default 0,  -- swept to the bank on this close
  float_out       numeric(12,2) not null default 0,  -- carried on to the next service
  unique (cash_session_id, method)
);
alter table public.cash_session_methods enable row level security;
drop policy if exists csm_select on public.cash_session_methods;
create policy csm_select on public.cash_session_methods for select to authenticated
  using (tenant_id = app.current_tenant_id());
grant select on public.cash_session_methods to authenticated;

create table if not exists public.bank_remittances (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.business_settings(id) on delete cascade,
  cash_session_id uuid not null references public.cash_sessions(id),
  method          text not null,
  amount          numeric(12,2) not null check (amount > 0),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.app_users(id)
);
alter table public.bank_remittances enable row level security;
drop policy if exists br_select on public.bank_remittances;
create policy br_select on public.bank_remittances for select to authenticated
  using (tenant_id = app.current_tenant_id());
grant select on public.bank_remittances to authenticated;

-- ── The Z report: written once, never rewritten ─────────────────────────────
create table if not exists public.z_reports (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.business_settings(id) on delete cascade,
  number          text not null,
  scope           text not null check (scope in ('service','day')),
  cash_session_id uuid references public.cash_sessions(id),
  trading_day_id  uuid not null references public.trading_days(id),
  totals          jsonb not null,
  note            text,                 -- the owner's "weather during service"
  closed_at       timestamptz not null default now(),
  closed_by       uuid references public.app_users(id),
  unique (tenant_id, number)
);
alter table public.z_reports enable row level security;
drop policy if exists z_select on public.z_reports;
create policy z_select on public.z_reports for select to authenticated
  using (tenant_id = app.current_tenant_id());
grant select on public.z_reports to authenticated;

-- A Z is a fiscal document. Nothing may edit or delete one.
drop trigger if exists trg_z_reports_append_only on public.z_reports;
create trigger trg_z_reports_append_only
  before update or delete on public.z_reports
  for each row execute function app.forbid_mutation();

drop trigger if exists trg_csm_append_only on public.cash_session_methods;
create trigger trg_csm_append_only
  before update or delete on public.cash_session_methods
  for each row execute function app.forbid_mutation();

-- Gapless Z numbers. A sequence would BURN a number on a rolled-back close (the
-- pending-bill guard can roll one back) and a gap in a fiscal series is exactly what
-- gets asked about.
alter table public.business_settings add column if not exists z_next_number int not null default 1;

-- A ticket belongs to the service that rang it, and to the day.
alter table public.documents add column if not exists cash_session_id uuid references public.cash_sessions(id);
alter table public.documents add column if not exists business_day date;
create index if not exists idx_documents_business_day on public.documents(tenant_id, business_day);

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function app.mu_today() returns date
language sql stable as $$ select ((now() at time zone 'Indian/Mauritius')::date) $$;

/** The open trading day, opening one if the shop has not opened today yet. */
create or replace function app.open_trading_day(p_tenant uuid) returns public.trading_days
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_day public.trading_days;
begin
  select * into v_day from public.trading_days
   where tenant_id = p_tenant and business_date = app.mu_today();
  if found then
    if v_day.status = 'closed' then
      raise exception 'the day of % is closed — reopen it before taking any more money', v_day.business_date;
    end if;
    return v_day;
  end if;
  insert into public.trading_days (tenant_id, business_date) values (p_tenant, app.mu_today())
  returning * into v_day;
  return v_day;
end $$;

/** Raises if the day that owns this session (or today) is closed. */
create or replace function app.assert_day_open(p_tenant uuid, p_session uuid default null) returns void
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_closed boolean;
begin
  if p_session is not null then
    select d.status = 'closed' into v_closed
      from public.cash_sessions s join public.trading_days d on d.id = s.trading_day_id
     where s.id = p_session;
    if coalesce(v_closed, false) then
      raise exception 'the day is closed — no more entries or transactions are possible';
    end if;
  end if;
  select status = 'closed' into v_closed from public.trading_days
   where tenant_id = p_tenant and business_date = app.mu_today();
  if coalesce(v_closed, false) then
    raise exception 'the day is closed — no more entries or transactions are possible';
  end if;
end $$;
