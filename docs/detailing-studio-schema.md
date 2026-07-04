# Carfectionist — Postgres schema (source of truth)

This document is the authoritative schema for the Carfectionist system. Migration
`0001_core.sql` implements everything here except the four items explicitly marked
**(0002)**, which land in `0002_pos_hardening.sql`. The schema is designed for a
single Supabase project shared by the Next.js back office and the Android POS,
single-tenant today and multi-tenant-ready by construction.

> Note on origin: the file originally shipped in the repo root as
> `detailing-studio-schema.md.txt` was a verbatim copy of the master prompt, not a
> schema. This document — authored from the approved architecture plan — is the real
> schema and supersedes it. The master prompt is preserved at
> [`docs/master-prompt.md`](./master-prompt.md).

---

## 0. Global conventions

- **Postgres 15+** (Supabase hosted). `pgcrypto` enabled for `gen_random_uuid()` and
  the local-seed `crypt()`.
- **Every table** has:
  - `id uuid primary key default gen_random_uuid()`
  - `tenant_id uuid not null references business_settings(id)`
    (exception: `business_settings` itself — its `id` *is* the tenant id)
  - `created_at timestamptz not null default now()`
  - Mutable tables additionally have `updated_at timestamptz not null default now()`
    maintained by the shared trigger `app.set_updated_at()`.
- **Money:** `numeric(12,2)` for all customer-facing amounts (prices, totals,
  payments). **Costs** (`products.cost_price`, `stock_movements.unit_cost`,
  purchase/PO costs) are `numeric(12,4)` — per-ml/per-gram consumable costs are
  sub-cent and 2 dp destroys COGS. **Quantities** are `numeric(12,3)`.
- **Rounding authority is the database.** VAT and line totals are Postgres
  **generated columns** (see `document_lines`); both clients display these values and
  never persist their own arithmetic. Rounding is `round(x, 2)` = round-half-away-from-zero,
  applied **at line level, then summed** — never re-rounded at document level.
- **Enums** (real Postgres enums → union types in generated clients):

  | enum | values |
  |---|---|
  | `user_role` | `owner`, `manager`, `cashier`, `technician`, `accountant` |
  | `product_kind` | `service`, `product`, `consumable` |
  | `product_unit` | `ml`, `l`, `g`, `kg`, `m2`, `piece`, `service` |
  | `doc_type` | `quote`, `invoice`, `credit_note` |
  | `doc_status` | `draft`, `issued`, `accepted`, `declined`, `expired`, `partly_paid`, `paid`, `void` |
  | `payment_method` | `cash`, `card`, `juice`, `bank_transfer` |
  | `movement_ref_type` | `invoice`, `credit_note`, `job_card`, `purchase_order`, `transfer`, `adjustment` |
  | `transfer_status` | `draft`, `dispatched`, `received`, `cancelled` |
  | `job_status` | `scheduled`, `in_progress`, `ready`, `delivered`, `cancelled` |
  | `po_status` | `draft`, `ordered`, `partially_received`, `received`, `cancelled` |

  `documents.origin` is a `text` column with a `check (origin in ('standalone',
  'from_job'))` — created in **(0002)**, spec-literal (not an enum).

- **Schemas:** client-callable tables and RPCs live in `public` (PostgREST-exposed);
  internal helpers live in a private `app` schema. All `security definer` functions
  set `search_path = public, pg_temp`. Execute is granted per-function to
  `authenticated` only where an RLS policy or client needs it.
- **Two write paths, by design:**
  1. *Direct table writes* — allowed only for draft/operational data (draft documents
     + lines, jobs, customers, vehicles, suppliers, `adjustment` stock movements,
     enquiries). Idempotent via client-generated UUID PKs.
  2. *Security-definer RPCs* — the **only** path for anything with an invariant:
     `issue_document`, `record_payment`, `reverse_payment`, `save_draft`,
     `convert_quote_to_invoice`, `void_document`, `dispatch_transfer`,
     `receive_transfer`, `receive_purchase_order`, `complete_job`,
     `close_cash_session`. RLS grants **no direct INSERT on `payments`** and only
     `adjustment` INSERTs on `stock_movements`, so the RPCs are structurally
     unavoidable.

---

## 1. Tables

Below, each table lists only its columns beyond the implicit
`id` / `tenant_id` / `created_at` (and `updated_at` where noted `(upd)`).

### business_settings — tenant root (its `id` **is** the tenant_id; no `tenant_id` column) `(upd)`
| column | type / notes |
|---|---|
| legal_name | `text not null` |
| trading_name | `text` |
| country | `text not null default 'MU'` |
| brn | `text` |
| vat_number | `text` |
| email | `text` |
| phone | `text` |
| address | `text` |
| bank_account_name | `text` |
| bank_account_number | `text` |
| bank_name | `text` |
| vat_rate | `numeric(5,2) not null default 15.00` |
| prices_vat_exclusive | `boolean not null default true` |
| quote_prefix | `text not null default 'A'` |
| quote_next_number | `integer not null default 1 check (> 0)` |
| quote_number_padding | `integer not null default 5` |
| invoice_prefix | `text not null default 'INV-'` |
| invoice_next_number | `integer not null default 1 check (> 0)` |
| invoice_number_padding | `integer not null default 4` |
| receipt_header_text | `text` **(0002)** |
| receipt_footer_text | `text` **(0002)** |
| receipt_logo_path | `text` **(0002)** |

*Phase 3 (additive, not shipped yet):* `credit_note_prefix 'CN-'`,
`credit_note_next_number`, `credit_note_number_padding`.

### app_users `(upd)`
| column | type / notes |
|---|---|
| auth_user_id | `uuid not null references auth.users(id) on delete cascade` |
| role | `user_role not null` |
| display_name | `text not null` |
| is_active | `boolean not null default true` |
| | `unique (auth_user_id)` — one tenant per login today; relax for multi-tenant later |

Surrogate `id` (not `auth.uid()` as PK) so a future SaaS can let one login belong to
multiple tenants by dropping the unique. All `created_by` / `technician_id` FKs point
at `app_users(id)`.

### customers `(upd)`
`name text not null`, `email text`, `phone text`, `address text`,
`country text not null default 'MU'` (template "For" box), `brn text`,
`vat_number text`, `notes text`. Indexes: `(tenant_id, name)`, `(tenant_id, phone)`.

### vehicles `(upd)`
`customer_id uuid not null references customers(id)`, `plate text not null`
(e.g. `1234 AB 26`), `plate_normalized text generated always as
(upper(regexp_replace(plate,'\s','','g'))) stored`, `make text`, `model text`,
`year integer`, `color text`, `vin text`, `notes text`.
`unique (tenant_id, plate_normalized)`; index `(tenant_id, customer_id)`.

### suppliers `(upd)`
`name text not null`, `email text`, `phone text`, `address text`, `brn text`,
`vat_number text`, `notes text`. Index `(tenant_id, name)`.

### products `(upd)`
| column | type / notes |
|---|---|
| sku | `text` |
| name | `text not null` |
| description | `text` |
| kind | `product_kind not null` |
| unit | `product_unit not null default 'piece'` |
| selling_price | `numeric(12,2) not null default 0` — VAT-exclusive |
| cost_price | `numeric(12,4) not null default 0` |
| vat_rate | `numeric(5,2)` — null = tenant default |
| is_stocked | `boolean not null default false` |
| low_stock_threshold | `numeric(12,3)` |
| is_active | `boolean not null default true` |
| barcode | `text` **(0002)** |
| | `check (kind <> 'service' or is_stocked = false)` |

Indexes: `(tenant_id, name)`, `(tenant_id, kind)`; **(0002)** partial unique
`(tenant_id, barcode) where barcode is not null`.

### stock_locations
`name text not null`, `is_default boolean not null default false`.
`unique (tenant_id, name)`; partial unique `(tenant_id) where is_default` (exactly one
default per tenant).

### stock_movements — append-only inventory ledger
| column | type / notes |
|---|---|
| product_id | `uuid not null references products(id)` |
| location_id | `uuid not null references stock_locations(id)` |
| qty | `numeric(12,3) not null check (qty <> 0)` — signed: `+` in, `−` out |
| unit_cost | `numeric(12,4)` — inbound: actual; outbound: `products.cost_price` at movement time (standard-cost COGS) |
| ref_type | `movement_ref_type not null` |
| ref_id | `uuid` — invoice/job/po/transfer id; null allowed **only** for `adjustment` |
| ref_line_id | `uuid` — document_line / transfer_line id |
| note | `text` |
| moved_at | `timestamptz not null default now()` |
| created_by | `uuid references app_users(id)` |
| | `check (ref_type = 'adjustment' or ref_id is not null)` |

Indexes: `(tenant_id, product_id, location_id)`, `(tenant_id, ref_type, ref_id)`,
`(tenant_id, moved_at)`. Double-fire guard: partial unique
`(tenant_id, ref_type, ref_id, ref_line_id, location_id) where ref_line_id is not null`.
`before update or delete` trigger `app.forbid_mutation()`.

### stock_on_hand — VIEW (never a stored quantity)
```sql
create view public.stock_on_hand with (security_invoker = true) as
select tenant_id, product_id, location_id,
       sum(qty)      as qty_on_hand,
       max(moved_at) as last_movement_at
from public.stock_movements
group by tenant_id, product_id, location_id;
```
`security_invoker = true` is critical — the view inherits the caller's RLS on
`stock_movements`.

### stock_transfers `(upd)` + stock_transfer_lines
**stock_transfers:** `from_location_id`, `to_location_id references stock_locations(id)`
`check (from <> to)`, `status transfer_status not null default 'draft'`,
`dispatched_at`, `dispatched_by`, `received_at`, `received_by`, `note`, `created_by`.
Index `(tenant_id, status)`.

**stock_transfer_lines:** `transfer_id references stock_transfers(id) on delete cascade`,
`product_id references products(id)`, `qty_dispatched numeric(12,3) not null check (> 0)`,
`qty_received numeric(12,3) check (qty_received >= 0 and qty_received <= qty_dispatched)`.
`unique (transfer_id, product_id)`.

Flow: `dispatch_transfer` fires `−qty_dispatched` movements at `from_location`;
`receive_transfer` fires `+qty_received` at `to_location`. Both `ref_type='transfer'`.
The dispatched−received gap is the in-transit loss — implicitly accounted (net stock
fell by the gap), no extra adjustment row.

### jobs `(upd)` + job_timers + job_photos
**jobs:** `customer_id references customers(id)`, `vehicle_id references vehicles(id)`,
`status job_status not null default 'scheduled'`, `scheduled_at`, `started_at`,
`ready_at`, `delivered_at`, `technician_id references app_users(id)`,
`checklist jsonb not null default '[]'`, `damage_markers jsonb not null default '[]'`,
`notes`, `created_by`. Indexes `(tenant_id, status)`, `(tenant_id, vehicle_id)`,
`(tenant_id, technician_id)`.

**job_timers:** `job_id references jobs(id) on delete cascade`,
`technician_id references app_users(id) not null`, `started_at timestamptz not null
default now()`, `stopped_at timestamptz check (stopped_at > started_at)`.

**job_photos:** `job_id references jobs(id) on delete cascade`,
`storage_path text not null` (bucket `vehicle-photos`), `caption`, `created_by`.

Job ↔ document link is one-directional: `documents.job_id → jobs(id)` (no doc FK on
jobs — avoids a circular FK).

### documents `(upd)` — ONE table for quotes, invoices, credit notes
| column | type / notes |
|---|---|
| doc_type | `doc_type not null` |
| status | `doc_status not null default 'draft'` |
| number | `text` — null until issue |
| issue_date | `date` |
| due_date | `date` |
| valid_until | `date` — quotes |
| customer_id | `uuid references customers(id)` |
| vehicle_id | `uuid references vehicles(id)` |
| job_id | `uuid references jobs(id)` |
| source_document_id | `uuid references documents(id)` — quote→invoice, invoice→credit_note |
| template_id | `uuid references document_templates(id)` |
| template_overrides | `jsonb not null default '{}'` — per-doc section toggles + custom-field values |
| currency | `char(3) not null default 'MUR'` |
| subtotal_excl | `numeric(12,2) not null default 0` — trigger-maintained from lines |
| vat_total | `numeric(12,2) not null default 0` — trigger-maintained |
| total_incl | `numeric(12,2) not null default 0` — trigger-maintained |
| amount_paid | `numeric(12,2) not null default 0` — `record_payment`/`reverse_payment` only |
| issued_legal_name | `text` — fiscal snapshot, stamped at issue |
| issued_brn | `text` |
| issued_vat_number | `text` |
| bill_to_name | `text` |
| bill_to_address | `text` |
| bill_to_brn | `text` |
| bill_to_vat_number | `text` |
| vat_breakdown | `jsonb` — `[{"rate":15.00,"base":77200.00,"vat":11580.00}]` |
| issued_at | `timestamptz` |
| voided_at | `timestamptz` |
| void_reason | `text` |
| mra_irn | `text` — MRA e-invoicing seam (nullable now) |
| mra_qr | `text` |
| mra_status | `text` |
| created_by | `uuid references app_users(id)` |
| revision | `integer not null default 0` — optimistic concurrency for `save_draft` |
| origin | `text not null default 'standalone' check (origin in ('standalone','from_job'))` **(0002)** |

Constraints:
- `unique (tenant_id, doc_type, number) where number is not null`
- `check (status = 'draft' or number is not null)`
- `check (doc_type <> 'invoice' or status = 'draft' or customer_id is not null)`
- per-type status check:
  - quote → `status in (draft, issued, accepted, declined, expired, void)`
  - invoice → `status in (draft, issued, partly_paid, paid, void)`
  - credit_note → `status in (draft, issued, void)`

Indexes: `(tenant_id, doc_type, status)`, `(tenant_id, customer_id)`,
`(tenant_id, issue_date)`, `(tenant_id, job_id)`.

### document_lines
| column | type / notes |
|---|---|
| document_id | `uuid not null references documents(id) on delete cascade` |
| product_id | `uuid references products(id)` — **NULLABLE BY DESIGN** (catalogue pick vs ad-hoc line) |
| title | `text not null` — product name copied at pick time, or free-typed |
| description | `text` — multi-line ad-hoc detail |
| qty | `numeric(12,3) not null default 1 check (> 0)` |
| unit_price | `numeric(12,2) not null default 0` — VAT-exclusive |
| discount_pct | `numeric(5,2) not null default 0 check (between 0 and 100)` |
| vat_rate | `numeric(5,2) not null` — snapshot from product/tenant default at line creation |
| line_total_excl | `numeric(12,2) generated always as (round(qty * unit_price * (1 - discount_pct/100.0), 2)) stored` |
| line_vat | `numeric(12,2) generated always as (round(round(qty * unit_price * (1 - discount_pct/100.0), 2) * vat_rate/100.0, 2)) stored` |
| sort_order | `integer not null default 0` |

(The `line_total_excl` expression is repeated inside `line_vat` because Postgres
generated columns cannot reference other generated columns.) A line "affects stock" iff
`product_id is not null and products.is_stocked` — evaluated **at issue time** in the
RPC; no stored flag. Indexes `(document_id)`, `(tenant_id, product_id)`.

### payments — append-only, children of the invoice document
| column | type / notes |
|---|---|
| document_id | `uuid not null references documents(id)` |
| method | `payment_method not null` |
| amount | `numeric(12,2) not null check (amount <> 0)` |
| tendered | `numeric(12,2)` — cash only |
| change_given | `numeric(12,2)` — cash only |
| external_ref | `text` — required for non-cash (unless a reversal) |
| reverses_payment_id | `uuid references payments(id)` |
| received_at | `timestamptz not null default now()` |
| received_by | `uuid references app_users(id)` |
| cash_session_id | `uuid references cash_sessions(id)` **(0002)** |

Checks:
- `check (amount > 0 or reverses_payment_id is not null)` — negatives only as reversals
- `check (method = 'cash' or (tendered is null and change_given is null))`
- `check (method <> 'cash' or reverses_payment_id is not null or (tendered is not null
  and tendered >= amount and change_given = tendered - amount))`
- `check (method = 'cash' or reverses_payment_id is not null or external_ref is not null)`

`before update or delete` trigger `app.forbid_mutation()`. Corrections happen only via
`reverse_payment` (negative mirror row + audit event). Indexes `(tenant_id,
document_id)`, `(tenant_id, received_at)`, `(cash_session_id)`.

### document_templates `(upd)`
`name text not null`, `doc_type doc_type` (null = any), `is_default boolean not null
default false`, `config jsonb not null default '{}'`. Partial unique `(tenant_id,
doc_type) where is_default`.

`config` shape (documented, not constrained):
```json
{
  "header_banner_path": "…", "footer_banner_path": "…", "logo_path": "…",
  "show_bank_details": true, "show_terms": true, "show_signature": false,
  "terms": ["Quotation is valid for 5 days.", "…"],
  "custom_fields": [{"label": "…", "value": "…"}]
}
```

### service_recipes — BOM per service
`service_product_id references products(id)` (kind `service`),
`component_product_id references products(id)` (stocked consumable),
`expected_qty numeric(12,3) not null check (> 0)` (component's unit).
`unique (tenant_id, service_product_id, component_product_id)`.

### purchase_orders `(upd)` + purchase_order_lines
**purchase_orders:** `supplier_id references suppliers(id)`, `status po_status not null
default 'draft'`, `reference text` (supplier's ref, free text — not a gapless series),
`order_date date`, `expected_date date`, `received_at timestamptz`, `notes`,
`created_by`. Indexes `(tenant_id, status)`, `(tenant_id, supplier_id)`.

**purchase_order_lines:** `purchase_order_id references purchase_orders(id) on delete
cascade`, `product_id references products(id)`, `qty_ordered numeric(12,3) not null
check (> 0)`, `unit_cost numeric(12,4) not null`, `qty_received numeric(12,3) not null
default 0`. `unique (purchase_order_id, product_id)`.

### expenses `(upd)`
`category text not null` (free text; UI suggests a list), `description text`,
`amount numeric(12,2) not null` (VAT-exclusive), `vat_amount numeric(12,2) not null
default 0`, `status text not null default 'due' check (status in ('paid','due'))`,
`expense_date date not null`, `paid_at date`, `supplier_id references suppliers(id)`,
`receipt_path text`, `created_by`. Indexes `(tenant_id, expense_date)`,
`(tenant_id, status)`.

### certificates
`number text not null` (app-assigned `CERT-…`, **not** the fiscal seam),
`customer_id references customers(id)`, `vehicle_id references vehicles(id)`,
`product_id references products(id)`, `invoice_id references documents(id)`,
`job_id references jobs(id)`, `applied_at date not null`, `warranty_months integer not
null check (> 0)`, `expires_at date not null`, `pdf_path text`, `notes`, `created_by`.
`unique (tenant_id, number)`; indexes `(tenant_id, vehicle_id)`,
`(tenant_id, expires_at)`.

### maintenance_reminders
`customer_id`, `vehicle_id`, `certificate_id references certificates(id)`,
`kind text not null`, `due_date date not null`, `status text not null default 'pending'
check (status in ('pending','sent','done','dismissed'))`, `sent_at timestamptz`,
`notes`. Index `(tenant_id, due_date, status)`.

### enquiries
`name text not null`, `phone text`, `email text`, `vehicle_info text`, `message text`,
`source text not null default 'web'`, `status text not null default 'new' check (status
in ('new','contacted','converted','spam','closed'))`,
`converted_customer_id references customers(id)`,
`converted_vehicle_id references vehicles(id)`. Index `(tenant_id, status, created_at)`.

### audit_events — append-only
`actor_id references app_users(id)`, `event_type text not null`
(`drawer_open_manual`, `document_voided`, `payment_reversed`, `settings_changed`, …),
`ref_type text`, `ref_id uuid`, `payload jsonb not null default '{}'`, `device_id text`.
`before update or delete` trigger `app.forbid_mutation()`. Index
`(tenant_id, event_type, created_at)`.

### idempotency_keys — internal (RLS enabled, ZERO policies; only definer RPCs touch it)
`key text not null`, `rpc text not null`, `result jsonb`. `unique (tenant_id, key)`;
index `(created_at)` for periodic pruning.

### cash_sessions `(upd)` **(0002)**
`device_id text not null`, `opened_by references app_users(id) not null`,
`opening_float numeric(12,2) not null`, `opened_at timestamptz not null default now()`,
`closed_by references app_users(id)`, `closing_count numeric(12,2)`,
`closed_at timestamptz`, `expected_cash numeric(12,2)`, `variance numeric(12,2)`,
`status text not null default 'open' check (status in ('open','closed'))`, `notes`.
Partial unique `(tenant_id, device_id) where status = 'open'` (one open session per
device); index `(tenant_id, opened_at)`. `expected_cash = opening_float + Σ cash
payment amounts in session`; `variance = closing_count − expected_cash` (computed by
`close_cash_session`).

---

## 2. Triggers / invariants

1. **`app.set_updated_at()`** — `before update` on every `(upd)` table.
2. **`app.forbid_mutation()`** — `before update or delete` on `stock_movements`,
   `payments`, `audit_events`: `raise exception '% is append-only', tg_table_name`.
   Fires even for service-role code (RLS is bypassed by service role; triggers are not).
3. **Fiscal lock** — `before update` on `documents`: the `number` is immutable once
   set; for issued `invoice`/`credit_note` rows, only the whitelist
   `[status, amount_paid, voided_at, void_reason, updated_at, revision, job_id,
   mra_irn, mra_qr, mra_status]` may change (jsonb diff of `to_jsonb(new) - whitelist`
   vs `to_jsonb(old) - whitelist`).
4. **Line lock** — `before insert or update or delete` on `document_lines`: reject if
   the parent is a non-draft `invoice`/`credit_note`.
5. **Totals trigger** — `after insert or update or delete` on `document_lines`:
   recompute parent `subtotal_excl = Σ line_total_excl`, `vat_total = Σ line_vat`,
   `total_incl = subtotal_excl + vat_total`. Runs on drafts only (guaranteed by the
   line lock), so it never collides with the fiscal lock. The DB is thus the single
   rounding authority for both clients.

---

## 3. RPCs

All are `security definer`, resolve the tenant internally, and take an optional
`p_idempotency_key text default null` that claims a row in `idempotency_keys` and
returns the stored result on replay (exactly-once for the Android outbox).

- **`issue_document(p_document_id uuid, p_stock_location_id uuid default null,
  p_idempotency_key text default null) returns documents`** — role check
  (owner/manager/cashier) → idempotency claim → lock the doc `for update`, require
  `draft` + ≥1 line (+ `customer_id` for invoices) →
  `app.next_document_number(tenant, doc_type)` (single `UPDATE business_settings …
  RETURNING` = atomic row lock, gapless; a rollback restores the counter) → stamp
  `number`, `issue_date`, `issued_at`, `status`, fiscal snapshot, and `vat_breakdown`
  → **if invoice: insert `−qty` sale movements** for stocked catalogue lines
  (`unit_cost = products.cost_price`, `ref_type='invoice'`, location = param or tenant
  default) → store result, return the row. *(Movements live in the RPC, not a trigger,
  so the location can be passed and idempotency composes cleanly.)*
- **`record_payment(p_invoice_id, p_method, p_amount, p_tendered default null,
  p_external_ref default null, p_cash_session_id default null, p_payment_id default
  null, p_idempotency_key default null) returns payments`** — lock invoice, require
  `issued`/`partly_paid`, `amount ≤ total_incl − amount_paid`, insert payment
  (client-suppliable `id` for the outbox), recompute `amount_paid` + status
  (`paid` / `partly_paid`).
- **`reverse_payment(p_payment_id, p_reason)`** (owner/manager) — insert negative
  mirror row, recompute status (floor `issued`), write `audit_events`.
- **`save_draft(p_doc jsonb, p_lines jsonb, p_expected_rev int)`** — upsert the draft
  document + replace its lines atomically; `revision` mismatch → error (optimistic
  concurrency for builder autosave).
- **`convert_quote_to_invoice(p_quote_id)`** — copy doc + lines into a new draft
  invoice, set `source_document_id`.
- **`void_document(p_id, p_reason)`** (owner/manager) — issued invoice with
  `amount_paid = 0` only; set `status='void'` + reversal `+qty` movements + audit.
  *(Credit notes for paid invoices: Phase 3 additive migration — `CN-` series columns,
  an `issue_document` branch, and `p_restock`.)*
- **`dispatch_transfer(p_id)`** / **`receive_transfer(p_id, p_lines jsonb)`**.
- **`receive_purchase_order(p_id, p_location, p_lines jsonb)`** — `+qty` `purchase_order`
  movements with `unit_cost`; updates `products.cost_price` (last-cost policy).
- **`complete_job(p_job_id, p_location, p_consumptions jsonb)`** — `−qty` `job_card`
  movements (unit_cost = cost_price), job → `ready`.
- **`close_cash_session(p_id, p_closing_count)`** **(0002)** — server computes
  `expected_cash` + `variance`, sets `status='closed'`.

### Gapless numbering helper
```sql
-- app.next_document_number(p_tenant uuid, p_doc_type doc_type) returns text
-- quote:   UPDATE business_settings SET quote_next_number = quote_next_number + 1 …
--          RETURNING quote_prefix, quote_next_number - 1, quote_number_padding
-- invoice: same against invoice_* columns
-- returns  v_prefix || lpad(v_num::text, v_pad, '0')
--   → 'A' || lpad(116,5,'0') = 'A00116';  'INV-' || lpad(1,4,'0') = 'INV-0001'
```
The single `UPDATE … RETURNING` takes the row lock inside the issue transaction, so a
failed issue rolls the counter back — **gapless by construction**. This helper is the
seam later swapped for MRA e-invoicing (IRN + QR) without touching callers.

---

## 4. Row-Level Security

Every table has RLS enabled. Helper functions (`app` schema, `security definer`,
`stable`, `set search_path = public, pg_temp`):

```sql
app.current_tenant_id()   -- select tenant_id from app_users where auth_user_id = auth.uid() and is_active
app.current_app_user_id() -- id of the same row
app.current_user_role()   -- role of the same row
app.require_role(variadic p_roles user_role[]) -- raises if current role not in list
```
`security definer` avoids RLS recursion on `app_users`. Policies use the
`(select app.current_tenant_id())` initplan pattern (evaluated once per statement).

**Standard policy set** (per table, to `authenticated`): select / insert / update /
delete all gated on `tenant_id = (select app.current_tenant_id())` (update repeats it
in `with check`).

**Deviations:**

| table | deviation |
|---|---|
| business_settings | select by `id = (select app.current_tenant_id())`; update owner/manager only; no insert/delete; series columns move only via RPC (`revoke update (quote_next_number, invoice_next_number)` from `authenticated`) |
| app_users | select tenant; update owner only (cannot change `tenant_id`); no insert/delete — provisioning via `create-staff-user` edge function (Auth Admin API + service role) |
| stock_movements | select tenant; **insert only** `ref_type='adjustment'` + role owner/manager; no update/delete. All other ref_types enter via RPCs only |
| payments | select tenant; **no insert/update/delete policies** — `record_payment`/`reverse_payment` only |
| documents | insert only `status='draft'` + `number is null`; update tenant (fiscal-lock trigger enforces immutability); delete drafts only, role owner/manager/cashier |
| document_lines | standard, keyed via `tenant_id`; line-lock trigger guards issued parents |
| expenses, audit_events | **select** restricted to owner/manager/accountant. `audit_events` insert: any tenant member (drawer opens from cashier devices); no update/delete |
| idempotency_keys | RLS enabled, **zero policies** — invisible to clients |
| cash_sessions | select/insert/update tenant; close only via `close_cash_session` RPC |

**Role gating split.** DB-enforced (hard security): tenant isolation, append-only
ledgers, RPC role checks, expenses/audit visibility, settings/price/template writes
owner/manager only. UI-only (convenience): hiding report screens and `products.cost_price`
from cashier/technician — those roles hold the row-level access their job needs, so RLS
cannot meaningfully hide the derived aggregate; documented trade-off.

**Service-role key** lives only in (a) the Next.js server (route handlers / server
actions — never `NEXT_PUBLIC_*`) and (b) edge functions. The Android app **never**
ships it — POS uses the anon key + user JWT, and everything privileged is a
security-definer RPC.

**Public enquiry form:** a `submit-enquiry` **edge function** (service role) validates,
rate-limits, resolves the tenant server-side, and inserts — so there are **no anon RLS
policies anywhere** and the RLS story stays uniform.

---

## 5. Storage buckets

All private; first path folder = `tenant_id`, so one policy pattern serves all.

| bucket | contents | path | limits |
|---|---|---|---|
| `vehicle-photos` | job & damage photos | `{tenant}/{job}/{uuid}.jpg` | 10 MB, `image/*` |
| `brand-assets` | template banners, logos, receipt logo | `{tenant}/templates/{uuid}.png`, `{tenant}/receipt/logo.png` | 5 MB, `image/*` |
| `certificates` | warranty PDFs | `{tenant}/{certificate_id}.pdf` | 10 MB, `application/pdf` |
| `documents-pdf` | issued-invoice PDF snapshots (server-written) | `{tenant}/{doc_id}.pdf` | 10 MB, `application/pdf` |

Policy pattern on `storage.objects`: `bucket_id = '…' and (storage.foldername(name))[1]
= (select app.current_tenant_id())::text`. Customer-facing sharing uses server-side
signed URLs.

---

## 6. VAT rounding — worked example

Line level, 2 dp, then sum; never re-rounded at document level:

| line | qty × price | line_total_excl | line_vat (×15%) |
|---|---|---|---|
| Full Decontamination & Body Polish | 1 × 32,000.00 | 32,000.00 | 4,800.00 |
| Remove Wheel, Decontamination & Polish | 4 × 3,800.00 | 15,200.00 | 2,280.00 |
| Diamondbrite 3-Year Protection | 1 × 30,000.00 | 30,000.00 | 4,500.00 |
| **subtotal** | | **77,200.00** | |
| **VAT** | | | **11,580.00** |
| **Total (MUR)** | | **88,780.00** | |

Amount in words: `EIGHTY EIGHT THOUSAND SEVEN HUNDRED EIGHTY RUPEES ONLY`.

---

## 7. Migration split

- **`0001_core.sql`** — everything above except items marked **(0002)**. DDL order:
  `pgcrypto` → enums → `app` schema + helpers → `business_settings` → `app_users` →
  `customers`/`vehicles`/`suppliers` → `products` → `stock_locations` →
  `stock_movements` (+ append-only trigger) → `stock_on_hand` view → transfers →
  `jobs` (**before** documents) → `job_timers`/`job_photos` → `document_templates` →
  `documents` (+ fiscal-lock, totals triggers) → `document_lines` (+ line lock) →
  `payments` (+ append-only) → `service_recipes` → `purchase_orders`(+lines) →
  `expenses` → `certificates` → `maintenance_reminders` → `enquiries` →
  `audit_events` (+ append-only) → `idempotency_keys` → RPCs → RLS → storage buckets
  + policies.
- **`0002_pos_hardening.sql`** — exactly the four spec items:
  1. `products.barcode` + partial unique index.
  2. `cash_sessions` (+ `payments.cash_session_id`, `close_cash_session`, one-open-per-device index).
  3. `business_settings` receipt fields.
  4. `documents.origin` (`text` + check).
- **`0003` (Phase 4, additive, not yet):** `documents.provisional_ref` +
  `created_at_client`; `updated_at`/`deleted_at` on POS-cached tables for delta sync;
  `devices` table; JWT claims hook if profiling demands.
