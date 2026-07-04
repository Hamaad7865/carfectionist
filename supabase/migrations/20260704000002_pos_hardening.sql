-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — migration 0002 (POS hardening)
-- Exactly the four spec items: barcode, cash_sessions, receipt settings,
-- documents.origin. Nothing else.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 ─── products.barcode (HID keyboard-wedge scanner lookup) ──────────────────
alter table products add column barcode text;
create unique index idx_products_barcode on products(tenant_id, barcode) where barcode is not null;

-- 2 ─── cash_sessions (+ payments.cash_session_id) ────────────────────────────
create table cash_sessions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references business_settings(id),
  device_id     text not null,
  opened_by     uuid not null references app_users(id),
  opening_float numeric(12,2) not null,
  opened_at     timestamptz not null default now(),
  closed_by     uuid references app_users(id),
  closing_count numeric(12,2),
  closed_at     timestamptz,
  expected_cash numeric(12,2),
  variance      numeric(12,2),
  status        text not null default 'open' check (status in ('open','closed')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index idx_cash_sessions_open on cash_sessions(tenant_id, device_id) where status = 'open';
create index idx_cash_sessions_opened on cash_sessions(tenant_id, opened_at);
create trigger trg_cash_sessions_updated before update on cash_sessions
  for each row execute function app.set_updated_at();

alter table payments add column cash_session_id uuid references cash_sessions(id);
create index idx_payments_cash_session on payments(cash_session_id);

alter table cash_sessions enable row level security;
create policy cs_select on cash_sessions for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy cs_insert on cash_sessions for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));
-- Updates (float corrections while open) allowed; close runs through the
-- close_cash_session RPC (Phase 3/4) which stamps expected_cash + variance.
create policy cs_update on cash_sessions for update to authenticated
  using (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));

grant select, insert, update, delete on cash_sessions to authenticated;

-- 3 ─── business_settings receipt config (80mm thermal) ───────────────────────
alter table business_settings
  add column receipt_header_text text,
  add column receipt_footer_text text,
  add column receipt_logo_path   text;

-- 4 ─── documents.origin (counter sale vs serviced job) ───────────────────────
-- Spec-literal: text + check (not an enum).
alter table documents
  add column origin text not null default 'standalone'
  check (origin in ('standalone','from_job'));
