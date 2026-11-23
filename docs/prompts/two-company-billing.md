# Prompt: one business, two issuing companies (VAT + non-VAT) — split billing

> Paste everything below the line into GitHub Copilot (agent mode, Claude Opus 5.5).

---

You are working in the **Carfectionist / HAZ Software** monorepo: a premium POS + back-office
system for Mauritius. One hosted Supabase (Postgres) backend, two clients:

- `apps/web/` — Next.js 16 App Router back office, deployed to Cloudflare Workers via OpenNext.
- `android/` — Kotlin / Jetpack Compose tablet POS (separate Gradle project).
- `supabase/migrations/` — schema + RPCs (the money path lives here).
- `scripts/` — DB ops and `_verify-*.mjs` verification scripts.

## Read these first, in full, before writing anything

1. `AGENTS.md` — repo rules. Its **Database invariants** and **Build / deploy gotchas** are
   non-negotiable. Follow them exactly.
2. `docs/detailing-studio-schema.md` — authoritative schema.
3. `ANDROID_PARITY.md` — every tablet change has a web twin and vice versa.
4. The latest definition of each function you will touch. Migrations redefine functions many
   times; the **last** file that does `create or replace function public.<name>` wins. For
   `issue_document` that is `supabase/migrations/20260810000045_restore_issue_document_replay_order.sql`;
   for `record_payment` it is `20260906000010_a_bill_finishes_every_car.sql`. Confirm against the
   live DB (`scripts/_dump-fn.mjs`) — do not trust an older file.
5. `apps/web/src/lib/supabase/rpc.ts` (the only allowed way to call money RPCs),
   `apps/web/src/lib/money/`, `apps/web/src/components/pdf/{DocumentA4,ReceiptCard,ZReportA4,SalesJournalA4}.tsx`,
   `apps/web/src/features/{counter,pos,jobs,documents,cash,reports,sales-journal,settings,products}`,
   and on Android `feature/{counter,settlement,till,jobs,quote,settings}` plus `core/{money,print,sync}`.

## The business problem

A new client owns **two legal companies** run from one site:

- **Tyre centre** — sells tyres and parts. **VAT-registered**, 15% VAT, prints its BRN and VAT number.
- **Service company** — wheel alignment, balancing, fitting labour. **Not VAT-registered**: its
  invoices carry **no VAT**, no VAT number and no "VAT invoice" wording.

A customer comes in for new tyres plus alignment and balancing. Staff ring it up **once**, on
**one** screen, for **one** customer and car, and the customer pays **once**. The system must
issue **two separate legal documents**: one invoice from the tyre centre (tyres only, with VAT)
and one from the service company (services only, no VAT). Each company has its **own gapless
number series**.

Today the system has one legal identity per tenant: `business_settings` holds the legal name,
BRN, VAT number, VAT rate and the quote/invoice counters, and its `id` **is** the `tenant_id`.
RLS isolates tenants via `app.current_tenant_id()`, and each auth user belongs to exactly one
tenant (`app_users.unique(auth_user_id)`). **Keep all of that.** Do not make the two companies two
tenants: tenants are walled off from each other, and this client needs shared customers, cars,
jobs, staff, stock and till.

## The design to implement: issuing entities inside a tenant

### 1. Schema (new numbered, additive migrations)

- New table **`legal_entities`** (tenant-scoped, RLS like every other table): `id`, `tenant_id`,
  `legal_name`, `trading_name`, `brn`, `vat_registered boolean not null`, `vat_number`,
  `vat_rate numeric(5,2)` (must be 0 when not VAT-registered — enforce with a CHECK), address,
  phone, email, bank fields, `logo_path`, per-entity numbering (`quote_prefix/next/padding`,
  `invoice_prefix/next/padding`, `credit_note_prefix/next/padding`), `is_default boolean`,
  `sort_order`, `is_active`, timestamps. Exactly one default entity per tenant (partial unique index).
- **Backfill:** create one default entity per existing tenant, copying its `business_settings`
  identity and **current counters**, so the Carfectionist shop (`…0001`) and the TEST Sandbox
  (`…0002`) keep the same series with no gap and no duplicate.
- **Exactly one source of truth for numbering.** After the backfill, `issue_document` (and the
  credit-note path) mint numbers from the document's entity row, locked `FOR UPDATE`. Grep the
  whole repo (SQL, web, Android, `scripts/`) for every reader or writer of
  `business_settings.*_next_number` / `*_prefix` and move each one to the entity. Do not leave two
  counters that can drift. Update the `AGENTS.md` line about resetting `invoice_next_number`
  after a reseed.
- `products.legal_entity_id` (nullable; null = the tenant's default entity).
- `documents.legal_entity_id not null`. Default it from the tenant's default entity in a trigger,
  so existing callers keep working. Add `documents.checkout_group_id uuid` (nullable) linking
  sibling documents issued from one checkout.
- **DB-enforced rules (triggers, not just UI):**
  - every line on a document belongs to that document's entity (a product line's product must
    resolve to the same entity; ad-hoc lines with `product_id` null inherit the document's entity);
  - on a non-VAT entity, every line's `vat_rate` is forced to 0;
  - the `issued_*` snapshot fields (`issued_brn`, `issued_vat_number`, the legal name…) are copied
    from the **entity** at issue time, not from `business_settings`;
  - the existing fiscal lock still applies: issued invoices are immutable.
- Replace every hard-coded 15% fallback (e.g. `coalesce((l->>'vat_rate')::numeric, 15)` in the
  line-insert paths) with the entity's rate. Grep for them all.

### 2. One checkout → one document per entity

- A new RPC (suggested name `issue_checkout`), wrapped in `rpc.ts`. It takes a mixed cart for one
  customer/vehicle and, **in one transaction**, groups lines by entity, creates one draft per
  entity, issues each one **through the existing `issue_document` seam** (never mint numbers
  anywhere else), stamps a shared `checkout_group_id`, and returns all documents. A cart with a
  single entity produces exactly one document, identical to today's behaviour.
- **Idempotency:** one idempotency key per checkout. A replay returns the same documents and
  numbers. This must work for the tablet's offline sales queue, which captures a sale and replays
  it later under its original key. The client never mints a fiscal number, even offline.
- **Payment, once for the whole visit:** add a group payment RPC that takes the tenders for the
  whole checkout (including split bills: an amount per method) and allocates them across the
  sibling invoices in one transaction, calling `record_payment`'s logic per invoice. Cash change is
  computed on the group total. It must pass the same till gate as today: every web payment passes
  the back-office till's `cashSessionId`, and a null session is rejected for all methods. A
  partial payment must leave every invoice in a correct `partly_paid` / `paid` state.
  Reversing a group payment reverses every leg.
- **Jobs and quotes:** a job or quote can hold lines from both entities. Billing a job
  (`create_document_from_job`, `convert_quote_to_invoice`, `convert_quote_to_job` billing paths)
  produces one invoice per entity, linked by `checkout_group_id`. A quote is not a tax document:
  issue it under the tenant's default entity, but show a subtotal block per entity, and VAT only
  on VAT-registered lines. If you find a legal or numbering problem with this, flag it in your plan
  instead of guessing.
- **Credit notes** always belong to the same entity as the invoice they credit, using that
  entity's credit-note series.

### 3. Documents, receipts and reports

- **A4 invoice / PDF (`DocumentA4`)** shows the issuing entity's name, logo, BRN and address. VAT
  entity: as today (ex-VAT lines, VAT row, VAT number). Non-VAT entity: no VAT column, no VAT row,
  no VAT number, plain "Invoice" title. Never hide a legal field on a VAT-registered document.
- **Till slip:** print one slip per invoice, back to back. The web `ReceiptCard` and the tablet
  `ReceiptText` / `ReceiptPaper` must stay **identical**: change them in the same commit with a
  shared fixture.
- **Email / WhatsApp sending** (`lib/send-document.ts`) sends every document in the checkout group.
- **Z report, sales journal, period close, reports and CSV exports:** show totals **per entity**
  plus the combined drawer. The cash drawer stays one physical drawer. Any VAT report covers only
  VAT-registered entities.

### 4. Settings and catalogue UI (web + tablet)

- Owner-only **Companies** settings page: list, add and edit entities (identity, VAT registration,
  numbering prefixes, logo). Once an entity has issued a document, its numbering and VAT
  registration can no longer change.
- Product form and product import/export: a "Sold by" entity picker or column.
- Counter / POS cart: when the tenant has more than one entity, group the cart by entity with a
  subtotal each and a single grand total. **A tenant with one entity sees no visible change
  anywhere.** This is the regression bar for Carfectionist.
- Mirror every change on Android (models, repositories, counter, settlement, offline queue,
  printing).

### 5. New-tenant onboarding

Add a script `scripts/create-tenant.mjs` that creates a tenant (`business_settings` row), its
entities and an owner user from a JSON file, inside one transaction, with placeholder values only.
**Do not create the real client's tenant**; the owner will supply the real company details later.

## Hard rules

- Work on a feature branch. **Never push to `main`**: it auto-deploys to production.
- The live database is **production data**. Test against the TEST Sandbox tenant
  (`…0000-000000000002`) and wrap SQL verification in `BEGIN … ROLLBACK`. Impersonate the tenant
  that owns the row, or the RPC will reject it with a domain error.
- `npm run db:push` **executes every migration file the tracker hasn't recorded**. Diff the tracker
  against the files before pushing, and push only after the plan is approved.
- `create or replace function` with a **changed signature adds a second overload** instead of
  replacing. When you change a signature, drop the old one explicitly and assert via `pg_proc`
  that exactly one version per name remains.
- Public-schema default privileges grant `anon` on new functions. Revoke `anon` and `public`
  **by name** on every new or recreated function, and assert it.
- Money: `numeric(12,2)` in the DB with line-level rounding (half away from zero) and then summed.
  Rupees cross the RPC boundary; integer cents above it. Use `src/lib/money/`; never re-implement
  totals in the client.
- Stock stays INSERT-only (`stock_movements`). Never weaken a failing test to get green.
- Build with webpack (`next build --webpack`). Do not add middleware/`proxy.ts`.

## Verification (required before you say "done")

1. `npm run test --workspace web` green, plus new vitest cases: totals for a mixed cart, a 0% entity,
   receipt fixtures for both entity types, and a single-entity tenant rendering byte-identical to
   before.
2. `cd apps/web && npx tsc --noEmit` clean; lint only the files you touched (lint on `main` is
   already red; compare against HEAD).
3. A new `scripts/_verify-two-company-checkout.mjs`, run against the sandbox inside a rolled-back
   transaction, proving:
   - a mixed cart produces exactly 2 invoices with the same `checkout_group_id`;
   - each invoice's number comes from its own entity's series, and both series are gapless;
   - the service invoice has 0 VAT and no VAT number; the tyre invoice has 15% VAT computed by the DB;
   - one group payment settles both invoices, and the till and Z report balance per entity and in total;
   - replaying the same idempotency key returns the same two documents and consumes no new numbers;
   - a credit note on the tyre invoice uses the tyre entity's credit-note series;
   - a single-entity tenant's checkout still issues one invoice, with the next number in its
     existing series.
4. Android: `./gradlew assembleDebug` succeeds, and the counter, settlement and receipt flows are
   exercised on the emulator with a debug build.
5. Append a `PROGRESS.md` entry listing any test rows left behind.

## How to work

Phase-gated. **First** write a plan to `docs/superpowers/plans/two-company-billing.md`: every
migration, every function you'll redefine (with its current latest file), every web and Android
file, the numbering cut-over strategy, and open questions. **Stop and wait for my approval.**
Then implement in this order, each phase verified before the next: (1) schema + backfill,
(2) numbering and `issue_checkout`, (3) group payments and the till, (4) documents, receipts and
reports, (5) web UI, (6) Android parity, (7) onboarding script and the full verification. Commit
per phase with clear messages. Report results in plain language: invoice numbers, rupees,
what was proven, and anything not verified.
