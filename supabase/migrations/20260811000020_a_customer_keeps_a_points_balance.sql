-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a customer keeps a points balance.
--
-- The ledger is the truth; customers.points_balance is a cached read of it, kept
-- by trigger. A balance stored on its own would eventually disagree with the
-- history and there would be no way to tell which was right — so every movement
-- is a row, and the column is only ever derived from one.
--
-- Append-only, like every other ledger here: app.forbid_mutation refuses an
-- UPDATE or a DELETE outright rather than trusting callers to be careful.
--
-- One shop-wide earn rate, not a table keyed on category: the owner's call on
-- 2026-08-10 is that earning follows the total price of a sale, not what
-- happened to be on it.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.customer_points_ledger (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.business_settings(id),
  customer_id uuid not null references public.customers(id),
  delta       integer not null,
  reason      text not null check (reason in ('earned','redeemed','adjusted','reversed')),
  ref_type    text,
  ref_id      uuid,
  note        text,
  created_by  uuid references public.app_users(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_points_ledger_customer
  on public.customer_points_ledger (tenant_id, customer_id, created_at desc);

-- One earn row per invoice. This is what makes earning idempotent under the
-- part-payment that finally settles a bill, and under an offline sale replaying.
create unique index if not exists idx_points_ledger_one_earn_per_doc
  on public.customer_points_ledger (ref_id) where reason = 'earned' and ref_type = 'document';

comment on table public.customer_points_ledger is
  'Every points movement, append-only. customers.points_balance is derived from this and never written directly.';

drop trigger if exists trg_points_ledger_immutable on public.customer_points_ledger;
create trigger trg_points_ledger_immutable
  before update or delete on public.customer_points_ledger
  for each row execute function app.forbid_mutation();

alter table public.customers
  add column if not exists points_balance integer not null default 0;

alter table public.business_settings
  add column if not exists points_per_100      numeric(12,2) not null default 1
    check (points_per_100 >= 0),
  add column if not exists point_value_rupees  numeric(12,2) not null default 1.00
    check (point_value_rupees > 0);

comment on column public.business_settings.points_per_100 is
  'Points earned per Rs 100 of a settled sale.';
comment on column public.business_settings.point_value_rupees is
  'What one point is worth when it is spent.';

create or replace function app.apply_points_delta() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  update public.customers
     set points_balance = points_balance + new.delta
   where id = new.customer_id;
  return null;
end $$;

drop trigger if exists trg_points_balance on public.customer_points_ledger;
create trigger trg_points_balance after insert on public.customer_points_ledger
  for each row execute function app.apply_points_delta();

alter table public.customer_points_ledger enable row level security;
drop policy if exists points_ledger_read on public.customer_points_ledger;
create policy points_ledger_read on public.customer_points_ledger
  for select using (tenant_id = (select app.current_tenant_id()));
