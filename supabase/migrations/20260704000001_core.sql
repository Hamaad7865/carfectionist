-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — migration 0001 (core schema)
-- Tables, checks, stock_on_hand view, invariant triggers, RLS on every table,
-- storage buckets. Money-path RPCs land in a Phase 1 migration.
-- See docs/detailing-studio-schema.md for the annotated schema.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

create schema if not exists app;
grant usage on schema app to authenticated;

-- ─── Enums ──────────────────────────────────────────────────────────────────
create type user_role         as enum ('owner','manager','cashier','technician','accountant');
create type product_kind      as enum ('service','product','consumable');
create type product_unit      as enum ('ml','l','g','kg','m2','piece','service');
create type doc_type          as enum ('quote','invoice','credit_note');
create type doc_status        as enum ('draft','issued','accepted','declined','expired','partly_paid','paid','void');
create type payment_method    as enum ('cash','card','juice','bank_transfer');
create type movement_ref_type as enum ('invoice','credit_note','job_card','purchase_order','transfer','adjustment');
create type transfer_status   as enum ('draft','dispatched','received','cancelled');
create type job_status        as enum ('scheduled','in_progress','ready','delivered','cancelled');
create type po_status         as enum ('draft','ordered','partially_received','received','cancelled');

-- ─── Generic trigger functions ──────────────────────────────────────────────
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only; % is not permitted', tg_table_name, tg_op;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- business_settings — tenant root (its id IS the tenant_id)
-- ═══════════════════════════════════════════════════════════════════════════
create table business_settings (
  id                     uuid primary key default gen_random_uuid(),
  legal_name             text not null,
  trading_name           text,
  country                text not null default 'MU',
  brn                    text,
  vat_number             text,
  email                  text,
  phone                  text,
  address                text,
  bank_account_name      text,
  bank_account_number    text,
  bank_name              text,
  vat_rate               numeric(5,2)  not null default 15.00,
  prices_vat_exclusive   boolean       not null default true,
  quote_prefix           text          not null default 'A',
  quote_next_number      integer       not null default 1 check (quote_next_number > 0),
  quote_number_padding   integer       not null default 5,
  invoice_prefix         text          not null default 'INV-',
  invoice_next_number    integer       not null default 1 check (invoice_next_number > 0),
  invoice_number_padding integer       not null default 4,
  created_at             timestamptz   not null default now(),
  updated_at             timestamptz   not null default now()
);
create trigger trg_business_settings_updated before update on business_settings
  for each row execute function app.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- app_users — auth.uid() → tenant + role
-- ═══════════════════════════════════════════════════════════════════════════
create table app_users (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references business_settings(id),
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  role          user_role not null,
  display_name  text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (auth_user_id)
);
create index idx_app_users_tenant on app_users(tenant_id);
create trigger trg_app_users_updated before update on app_users
  for each row execute function app.set_updated_at();

-- ─── RLS helper functions (security definer over app_users) ──────────────────
create or replace function app.current_tenant_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select tenant_id from public.app_users where auth_user_id = auth.uid() and is_active limit 1
$$;

create or replace function app.current_app_user_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.app_users where auth_user_id = auth.uid() and is_active limit 1
$$;

create or replace function app.current_user_role() returns user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.app_users where auth_user_id = auth.uid() and is_active limit 1
$$;

create or replace function app.require_role(variadic p_roles user_role[]) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if coalesce(
       (select role from public.app_users where auth_user_id = auth.uid() and is_active limit 1) = any(p_roles),
       false)
  then return; end if;
  raise exception 'insufficient privileges: requires one of %', p_roles;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Contacts
-- ═══════════════════════════════════════════════════════════════════════════
create table customers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references business_settings(id),
  name       text not null,
  email      text,
  phone      text,
  address    text,
  country    text not null default 'MU',
  brn        text,
  vat_number text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_customers_name  on customers(tenant_id, name);
create index idx_customers_phone on customers(tenant_id, phone);
create trigger trg_customers_updated before update on customers
  for each row execute function app.set_updated_at();

create table vehicles (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references business_settings(id),
  customer_id      uuid not null references customers(id),
  plate            text not null,
  plate_normalized text generated always as (upper(regexp_replace(plate, '\s', '', 'g'))) stored,
  make             text,
  model            text,
  year             integer,
  color            text,
  vin              text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, plate_normalized)
);
create index idx_vehicles_customer on vehicles(tenant_id, customer_id);
create trigger trg_vehicles_updated before update on vehicles
  for each row execute function app.set_updated_at();

create table suppliers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references business_settings(id),
  name       text not null,
  email      text,
  phone      text,
  address    text,
  brn        text,
  vat_number text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_suppliers_name on suppliers(tenant_id, name);
create trigger trg_suppliers_updated before update on suppliers
  for each row execute function app.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Catalogue & inventory
-- ═══════════════════════════════════════════════════════════════════════════
create table products (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references business_settings(id),
  sku                 text,
  name                text not null,
  description         text,
  kind                product_kind not null,
  unit                product_unit not null default 'piece',
  selling_price       numeric(12,2) not null default 0,   -- VAT-exclusive
  cost_price          numeric(12,4) not null default 0,
  vat_rate            numeric(5,2),                        -- null = tenant default
  is_stocked          boolean not null default false,
  low_stock_threshold numeric(12,3),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (kind <> 'service' or is_stocked = false)
);
create index idx_products_name on products(tenant_id, name);
create index idx_products_kind on products(tenant_id, kind);
create trigger trg_products_updated before update on products
  for each row execute function app.set_updated_at();

create table stock_locations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references business_settings(id),
  name       text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create unique index idx_stock_locations_default on stock_locations(tenant_id) where is_default;

create table stock_movements (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references business_settings(id),
  product_id  uuid not null references products(id),
  location_id uuid not null references stock_locations(id),
  qty         numeric(12,3) not null check (qty <> 0),  -- signed: + in, − out
  unit_cost   numeric(12,4),
  ref_type    movement_ref_type not null,
  ref_id      uuid,
  ref_line_id uuid,
  note        text,
  moved_at    timestamptz not null default now(),
  created_by  uuid references app_users(id),
  created_at  timestamptz not null default now(),
  check (ref_type = 'adjustment' or ref_id is not null)
);
create index idx_movements_product on stock_movements(tenant_id, product_id, location_id);
create index idx_movements_ref     on stock_movements(tenant_id, ref_type, ref_id);
create index idx_movements_moved   on stock_movements(tenant_id, moved_at);
create unique index idx_movements_dedup on stock_movements(tenant_id, ref_type, ref_id, ref_line_id, location_id)
  where ref_line_id is not null;
create trigger trg_movements_append_only before update or delete on stock_movements
  for each row execute function app.forbid_mutation();

-- On-hand = the ledger, summed. security_invoker so the caller's RLS applies.
create view stock_on_hand with (security_invoker = true) as
  select tenant_id, product_id, location_id,
         sum(qty)      as qty_on_hand,
         max(moved_at) as last_movement_at
  from stock_movements
  group by tenant_id, product_id, location_id;

-- ─── Stock transfers ────────────────────────────────────────────────────────
create table stock_transfers (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references business_settings(id),
  from_location_id uuid not null references stock_locations(id),
  to_location_id   uuid not null references stock_locations(id),
  status           transfer_status not null default 'draft',
  dispatched_at    timestamptz,
  dispatched_by    uuid references app_users(id),
  received_at      timestamptz,
  received_by      uuid references app_users(id),
  note             text,
  created_by       uuid references app_users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (from_location_id <> to_location_id)
);
create index idx_transfers_status on stock_transfers(tenant_id, status);
create trigger trg_transfers_updated before update on stock_transfers
  for each row execute function app.set_updated_at();

create table stock_transfer_lines (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references business_settings(id),
  transfer_id    uuid not null references stock_transfers(id) on delete cascade,
  product_id     uuid not null references products(id),
  qty_dispatched numeric(12,3) not null check (qty_dispatched > 0),
  qty_received   numeric(12,3) check (qty_received >= 0 and qty_received <= qty_dispatched),
  created_at     timestamptz not null default now(),
  unique (transfer_id, product_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Jobs (created BEFORE documents — documents.job_id → jobs)
-- ═══════════════════════════════════════════════════════════════════════════
create table jobs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references business_settings(id),
  customer_id    uuid not null references customers(id),
  vehicle_id     uuid not null references vehicles(id),
  status         job_status not null default 'scheduled',
  scheduled_at   timestamptz,
  started_at     timestamptz,
  ready_at       timestamptz,
  delivered_at   timestamptz,
  technician_id  uuid references app_users(id),
  checklist      jsonb not null default '[]',
  damage_markers jsonb not null default '[]',
  notes          text,
  created_by     uuid references app_users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_jobs_status  on jobs(tenant_id, status);
create index idx_jobs_vehicle on jobs(tenant_id, vehicle_id);
create index idx_jobs_tech    on jobs(tenant_id, technician_id);
create trigger trg_jobs_updated before update on jobs
  for each row execute function app.set_updated_at();

create table job_timers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references business_settings(id),
  job_id        uuid not null references jobs(id) on delete cascade,
  technician_id uuid not null references app_users(id),
  started_at    timestamptz not null default now(),
  stopped_at    timestamptz,
  created_at    timestamptz not null default now(),
  check (stopped_at is null or stopped_at > started_at)
);
create index idx_job_timers_job on job_timers(job_id);

create table job_photos (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references business_settings(id),
  job_id       uuid not null references jobs(id) on delete cascade,
  storage_path text not null,
  caption      text,
  created_by   uuid references app_users(id),
  created_at   timestamptz not null default now()
);
create index idx_job_photos_job on job_photos(job_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Document templates
-- ═══════════════════════════════════════════════════════════════════════════
create table document_templates (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references business_settings(id),
  name       text not null,
  doc_type   doc_type,                    -- null = usable for any
  is_default boolean not null default false,
  config     jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index idx_templates_default on document_templates(tenant_id, doc_type) where is_default;
create trigger trg_templates_updated before update on document_templates
  for each row execute function app.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Documents (quotes / invoices / credit notes) + lines
-- ═══════════════════════════════════════════════════════════════════════════
create table documents (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references business_settings(id),
  doc_type           doc_type not null,
  status             doc_status not null default 'draft',
  number             text,
  issue_date         date,
  due_date           date,
  valid_until        date,
  customer_id        uuid references customers(id),
  vehicle_id         uuid references vehicles(id),
  job_id             uuid references jobs(id),
  source_document_id uuid references documents(id),
  template_id        uuid references document_templates(id),
  template_overrides jsonb not null default '{}',
  currency           char(3) not null default 'MUR',
  subtotal_excl      numeric(12,2) not null default 0,
  vat_total          numeric(12,2) not null default 0,
  total_incl         numeric(12,2) not null default 0,
  amount_paid        numeric(12,2) not null default 0,
  issued_legal_name  text,
  issued_brn         text,
  issued_vat_number  text,
  bill_to_name       text,
  bill_to_address    text,
  bill_to_brn        text,
  bill_to_vat_number text,
  vat_breakdown      jsonb,
  issued_at          timestamptz,
  voided_at          timestamptz,
  void_reason        text,
  mra_irn            text,
  mra_qr             text,
  mra_status         text,
  revision           integer not null default 0,
  created_by         uuid references app_users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (status = 'draft' or number is not null),
  check (doc_type <> 'invoice' or status = 'draft' or customer_id is not null),
  check (
    (doc_type = 'quote'       and status in ('draft','issued','accepted','declined','expired','void')) or
    (doc_type = 'invoice'     and status in ('draft','issued','partly_paid','paid','void')) or
    (doc_type = 'credit_note' and status in ('draft','issued','void'))
  )
);
create unique index idx_documents_number on documents(tenant_id, doc_type, number) where number is not null;
create index idx_documents_type_status on documents(tenant_id, doc_type, status);
create index idx_documents_customer    on documents(tenant_id, customer_id);
create index idx_documents_issue_date  on documents(tenant_id, issue_date);
create index idx_documents_job         on documents(tenant_id, job_id);
create trigger trg_documents_updated before update on documents
  for each row execute function app.set_updated_at();

-- Fiscal lock: number immutable once set; issued invoices/credit notes frozen
-- except for a small whitelist of operational columns.
create or replace function app.enforce_document_lock() returns trigger
language plpgsql as $$
declare
  mutable text[] := array['status','amount_paid','voided_at','void_reason',
                          'updated_at','revision','job_id','mra_irn','mra_qr','mra_status'];
begin
  if old.number is not null and new.number is distinct from old.number then
    raise exception 'document number is immutable once assigned';
  end if;
  if old.doc_type in ('invoice','credit_note') and old.status <> 'draft' then
    if (to_jsonb(new) - mutable) is distinct from (to_jsonb(old) - mutable) then
      raise exception 'issued fiscal documents are immutable';
    end if;
  end if;
  return new;
end $$;
create trigger trg_documents_fiscal_lock before update on documents
  for each row execute function app.enforce_document_lock();

create table document_lines (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references business_settings(id),
  document_id     uuid not null references documents(id) on delete cascade,
  product_id      uuid references products(id),        -- NULLABLE BY DESIGN
  title           text not null,
  description     text,
  qty             numeric(12,3) not null default 1 check (qty > 0),
  unit_price      numeric(12,2) not null default 0,    -- VAT-exclusive
  discount_pct    numeric(5,2)  not null default 0 check (discount_pct >= 0 and discount_pct <= 100),
  vat_rate        numeric(5,2)  not null,
  line_total_excl numeric(12,2) generated always as
                    (round(qty * unit_price * (1 - discount_pct/100.0), 2)) stored,
  line_vat        numeric(12,2) generated always as
                    (round(round(qty * unit_price * (1 - discount_pct/100.0), 2) * vat_rate/100.0, 2)) stored,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);
create index idx_lines_document on document_lines(document_id);
create index idx_lines_product  on document_lines(tenant_id, product_id);

-- Line lock: no edits to lines of an issued invoice/credit note.
create or replace function app.enforce_line_lock() returns trigger
language plpgsql as $$
declare
  v_doc_id uuid := coalesce(new.document_id, old.document_id);
  v_type   doc_type;
  v_status doc_status;
begin
  select doc_type, status into v_type, v_status from public.documents where id = v_doc_id;
  if v_type in ('invoice','credit_note') and v_status is distinct from 'draft' then
    raise exception 'cannot modify lines of an issued %', v_type;
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_lines_lock before insert or update or delete on document_lines
  for each row execute function app.enforce_line_lock();

-- Totals: DB is the single rounding authority. Recompute parent on any line change.
create or replace function app.recompute_document_totals() returns trigger
language plpgsql as $$
declare v_doc uuid := coalesce(new.document_id, old.document_id);
begin
  update public.documents d
     set subtotal_excl = t.sub,
         vat_total     = t.vat,
         total_incl    = t.sub + t.vat
  from (
    select coalesce(sum(line_total_excl),0) as sub,
           coalesce(sum(line_vat),0)        as vat
    from public.document_lines where document_id = v_doc
  ) t
  where d.id = v_doc;
  return null;
end $$;
create trigger trg_lines_totals after insert or update or delete on document_lines
  for each row execute function app.recompute_document_totals();

-- ═══════════════════════════════════════════════════════════════════════════
-- Payments — append-only, children of the invoice
-- ═══════════════════════════════════════════════════════════════════════════
create table payments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references business_settings(id),
  document_id         uuid not null references documents(id),
  method              payment_method not null,
  amount              numeric(12,2) not null check (amount <> 0),
  tendered            numeric(12,2),
  change_given        numeric(12,2),
  external_ref        text,
  reverses_payment_id uuid references payments(id),
  received_at         timestamptz not null default now(),
  received_by         uuid references app_users(id),
  created_at          timestamptz not null default now(),
  check (amount > 0 or reverses_payment_id is not null),
  check (method = 'cash' or (tendered is null and change_given is null)),
  check (method <> 'cash' or reverses_payment_id is not null
         or (tendered is not null and tendered >= amount and change_given = tendered - amount)),
  check (method = 'cash' or reverses_payment_id is not null or external_ref is not null)
);
create index idx_payments_document on payments(tenant_id, document_id);
create index idx_payments_received on payments(tenant_id, received_at);
create trigger trg_payments_append_only before update or delete on payments
  for each row execute function app.forbid_mutation();

-- ═══════════════════════════════════════════════════════════════════════════
-- Service recipes (BOM), purchase orders, expenses
-- ═══════════════════════════════════════════════════════════════════════════
create table service_recipes (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references business_settings(id),
  service_product_id   uuid not null references products(id),
  component_product_id uuid not null references products(id),
  expected_qty         numeric(12,3) not null check (expected_qty > 0),
  created_at           timestamptz not null default now(),
  unique (tenant_id, service_product_id, component_product_id)
);

create table purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references business_settings(id),
  supplier_id   uuid not null references suppliers(id),
  status        po_status not null default 'draft',
  reference     text,
  order_date    date,
  expected_date date,
  received_at   timestamptz,
  notes         text,
  created_by    uuid references app_users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_po_status   on purchase_orders(tenant_id, status);
create index idx_po_supplier on purchase_orders(tenant_id, supplier_id);
create trigger trg_po_updated before update on purchase_orders
  for each row execute function app.set_updated_at();

create table purchase_order_lines (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references business_settings(id),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  product_id        uuid not null references products(id),
  qty_ordered       numeric(12,3) not null check (qty_ordered > 0),
  unit_cost         numeric(12,4) not null,
  qty_received      numeric(12,3) not null default 0,
  created_at        timestamptz not null default now(),
  unique (purchase_order_id, product_id)
);

create table expenses (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references business_settings(id),
  category     text not null,
  description  text,
  amount       numeric(12,2) not null,   -- VAT-exclusive
  vat_amount   numeric(12,2) not null default 0,
  status       text not null default 'due' check (status in ('paid','due')),
  expense_date date not null,
  paid_at      date,
  supplier_id  uuid references suppliers(id),
  receipt_path text,
  created_by   uuid references app_users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_expenses_date   on expenses(tenant_id, expense_date);
create index idx_expenses_status on expenses(tenant_id, status);
create trigger trg_expenses_updated before update on expenses
  for each row execute function app.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Certificates, reminders, enquiries, audit, idempotency
-- ═══════════════════════════════════════════════════════════════════════════
create table certificates (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references business_settings(id),
  number          text not null,
  customer_id     uuid not null references customers(id),
  vehicle_id      uuid not null references vehicles(id),
  product_id      uuid references products(id),
  invoice_id      uuid references documents(id),
  job_id          uuid references jobs(id),
  applied_at      date not null,
  warranty_months integer not null check (warranty_months > 0),
  expires_at      date not null,
  pdf_path        text,
  notes           text,
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now(),
  unique (tenant_id, number)
);
create index idx_certificates_vehicle on certificates(tenant_id, vehicle_id);
create index idx_certificates_expires on certificates(tenant_id, expires_at);

create table maintenance_reminders (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references business_settings(id),
  customer_id    uuid not null references customers(id),
  vehicle_id     uuid not null references vehicles(id),
  certificate_id uuid references certificates(id),
  kind           text not null,
  due_date       date not null,
  status         text not null default 'pending' check (status in ('pending','sent','done','dismissed')),
  sent_at        timestamptz,
  notes          text,
  created_at     timestamptz not null default now()
);
create index idx_reminders_due on maintenance_reminders(tenant_id, due_date, status);

create table enquiries (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references business_settings(id),
  name                 text not null,
  phone                text,
  email                text,
  vehicle_info         text,
  message              text,
  source               text not null default 'web',
  status               text not null default 'new' check (status in ('new','contacted','converted','spam','closed')),
  converted_customer_id uuid references customers(id),
  converted_vehicle_id  uuid references vehicles(id),
  created_at           timestamptz not null default now()
);
create index idx_enquiries_status on enquiries(tenant_id, status, created_at);

create table audit_events (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references business_settings(id),
  actor_id   uuid references app_users(id),
  event_type text not null,
  ref_type   text,
  ref_id     uuid,
  payload    jsonb not null default '{}',
  device_id  text,
  created_at timestamptz not null default now()
);
create index idx_audit_type on audit_events(tenant_id, event_type, created_at);
create trigger trg_audit_append_only before update or delete on audit_events
  for each row execute function app.forbid_mutation();

create table idempotency_keys (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references business_settings(id),
  key        text not null,
  rpc        text not null,
  result     jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);
create index idx_idempotency_created on idempotency_keys(created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-Level Security
-- ═══════════════════════════════════════════════════════════════════════════
alter table business_settings   enable row level security;
alter table app_users           enable row level security;
alter table customers           enable row level security;
alter table vehicles            enable row level security;
alter table suppliers           enable row level security;
alter table products            enable row level security;
alter table stock_locations     enable row level security;
alter table stock_movements     enable row level security;
alter table stock_transfers     enable row level security;
alter table stock_transfer_lines enable row level security;
alter table jobs                enable row level security;
alter table job_timers          enable row level security;
alter table job_photos          enable row level security;
alter table document_templates  enable row level security;
alter table documents           enable row level security;
alter table document_lines      enable row level security;
alter table payments            enable row level security;
alter table service_recipes     enable row level security;
alter table purchase_orders     enable row level security;
alter table purchase_order_lines enable row level security;
alter table expenses            enable row level security;
alter table certificates        enable row level security;
alter table maintenance_reminders enable row level security;
alter table enquiries           enable row level security;
alter table audit_events        enable row level security;
alter table idempotency_keys    enable row level security;

-- Helper: standard tenant policies are written explicitly per table below.
-- (No dynamic SQL — keep policies greppable and reviewable.)

-- business_settings: select own tenant; update owner/manager; no insert/delete.
create policy bs_select on business_settings for select to authenticated
  using (id = (select app.current_tenant_id()));
create policy bs_update on business_settings for update to authenticated
  using (id = (select app.current_tenant_id())
         and (select app.current_user_role()) in ('owner','manager'))
  with check (id = (select app.current_tenant_id()));
-- Series counters move only via RPC, never a direct client update.
revoke update (quote_next_number, invoice_next_number) on business_settings from authenticated;

-- app_users: select within tenant; update owner only; provisioning via edge function.
create policy au_select on app_users for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy au_update on app_users for update to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) = 'owner')
  with check (tenant_id = (select app.current_tenant_id()));

-- Standard full-CRUD tenant tables.
do $$
declare t text;
begin
  foreach t in array array[
    'customers','vehicles','suppliers','products','stock_locations',
    'stock_transfers','stock_transfer_lines','jobs','job_timers','job_photos',
    'document_templates','service_recipes','purchase_orders','purchase_order_lines',
    'maintenance_reminders','enquiries'
  ] loop
    execute format($f$
      create policy %1$s_select on %1$s for select to authenticated
        using (tenant_id = (select app.current_tenant_id()));
      create policy %1$s_insert on %1$s for insert to authenticated
        with check (tenant_id = (select app.current_tenant_id()));
      create policy %1$s_update on %1$s for update to authenticated
        using (tenant_id = (select app.current_tenant_id()))
        with check (tenant_id = (select app.current_tenant_id()));
      create policy %1$s_delete on %1$s for delete to authenticated
        using (tenant_id = (select app.current_tenant_id()));
    $f$, t);
  end loop;
end $$;

-- stock_movements: read tenant; INSERT only adjustments by owner/manager; no upd/del.
create policy sm_select on stock_movements for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy sm_insert on stock_movements for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id())
              and ref_type = 'adjustment'
              and (select app.current_user_role()) in ('owner','manager'));

-- documents: read tenant; INSERT drafts only; UPDATE tenant (fiscal-lock trigger enforces
-- immutability); DELETE drafts only by owner/manager/cashier.
create policy doc_select on documents for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy doc_insert on documents for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id())
              and status = 'draft' and number is null);
create policy doc_update on documents for update to authenticated
  using (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));
create policy doc_delete on documents for delete to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and status = 'draft'
         and (select app.current_user_role()) in ('owner','manager','cashier'));

-- document_lines: full CRUD within tenant (line-lock trigger guards issued parents).
create policy dl_select on document_lines for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy dl_insert on document_lines for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));
create policy dl_update on document_lines for update to authenticated
  using (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));
create policy dl_delete on document_lines for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()));

-- payments: read only; all writes go through record_payment / reverse_payment RPCs.
create policy pay_select on payments for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

-- expenses: read/write restricted to owner/manager/accountant.
create policy exp_select on expenses for select to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) in ('owner','manager','accountant'));
create policy exp_insert on expenses for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id())
              and (select app.current_user_role()) in ('owner','manager','accountant'));
create policy exp_update on expenses for update to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) in ('owner','manager','accountant'))
  with check (tenant_id = (select app.current_tenant_id()));
create policy exp_delete on expenses for delete to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) in ('owner','manager'));

-- certificates: read/write within tenant (creation via RPC later; direct ok for now).
create policy cert_select on certificates for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy cert_insert on certificates for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));
create policy cert_update on certificates for update to authenticated
  using (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));

-- audit_events: insert by any tenant member; read owner/manager/accountant; no upd/del.
create policy audit_select on audit_events for select to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) in ('owner','manager','accountant'));
create policy audit_insert on audit_events for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));

-- idempotency_keys: RLS enabled with NO policies — invisible to clients; RPCs only.

-- Base table privileges (RLS is the real gate; grants let authenticated attempt ops).
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on stock_on_hand to authenticated;
-- Lock down app-schema functions; expose only the RLS helpers to clients.
revoke execute on all functions in schema app from public;
grant execute on function app.current_tenant_id()   to authenticated;
grant execute on function app.current_app_user_id()  to authenticated;
grant execute on function app.current_user_role()    to authenticated;
grant execute on function app.require_role(user_role[]) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Storage buckets (private) + policies (first path folder = tenant_id)
-- ═══════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('vehicle-photos', 'vehicle-photos', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('brand-assets',   'brand-assets',   false,  5242880, array['image/jpeg','image/png','image/webp','image/svg+xml']),
  ('certificates',   'certificates',   false, 10485760, array['application/pdf']),
  ('documents-pdf',  'documents-pdf',  false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

do $$
declare b text;
begin
  foreach b in array array['vehicle-photos','brand-assets','certificates','documents-pdf'] loop
    execute format($f$
      create policy %2$s_read on storage.objects for select to authenticated
        using (bucket_id = %1$L
               and (storage.foldername(name))[1] = (select app.current_tenant_id())::text);
      create policy %2$s_insert on storage.objects for insert to authenticated
        with check (bucket_id = %1$L
               and (storage.foldername(name))[1] = (select app.current_tenant_id())::text);
      create policy %2$s_update on storage.objects for update to authenticated
        using (bucket_id = %1$L
               and (storage.foldername(name))[1] = (select app.current_tenant_id())::text);
      create policy %2$s_delete on storage.objects for delete to authenticated
        using (bucket_id = %1$L
               and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
               and (select app.current_user_role()) in ('owner','manager'));
    $f$, b, replace(b,'-','_'));
  end loop;
end $$;
