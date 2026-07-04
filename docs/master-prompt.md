# MASTER PROMPT — paste into Claude Code
# (Keep `detailing-studio-schema.md` in the repo root before starting.)

You are building a complete business management system for a premium car detailing studio in Mauritius (working name: **Carfectionist system**), developed under Haz Software. It has two surfaces on one shared backend:

1. A **web back office** (cloud, always online) — the admin brain: documents, customers, inventory, purchasing, accounting, reports.
2. An **Android tablet POS** (online-primary, offline fallback) — the front of house: intake, quotes, jobs, checkout, receipt printing.

You will build them **in the phase order below, one phase at a time**. This is a hard rule: at the end of every phase, STOP, give me a manual test script for that phase's definition of done, and wait for my confirmation before starting the next phase. Do not build ahead. Phase 1 complete and verified beats Phase 3 scaffolded.

---

## Stack — fixed, do not substitute
- **Backend:** Supabase — Postgres, Auth, Storage, Row-Level Security. Single project shared by both surfaces.
- **Web:** Next.js (App Router) + TypeScript + Tailwind. Deploy target: Cloudflare Pages.
- **Android:** Kotlin + Jetpack Compose, landscape tablet (~10–12"), Supabase Kotlin client.
- **PDF:** server-side in the web app (pick `@react-pdf/renderer` or a Puppeteer route and stay with it).
- **DB access:** Supabase clients with generated types. No ORM.
- Ask before adding any dependency beyond these.

## Business constants
Currency **MUR**, displayed `Rs 32,000.00`. VAT **15%**, prices **VAT-exclusive** (tax added on top). Locale: Mauritius.

---

## Source of truth: the schema

`detailing-studio-schema.md` (repo root) contains the complete Postgres schema. Implement it **exactly** as migration 0001 — tables, columns, checks, the `stock_on_hand` view, and RLS (`tenant_id` isolation via `app_users`). Then add **migration 0002**:

- `products.barcode text` — nullable, indexed (a HID keyboard-wedge barcode scanner will drive POS lookup).
- `cash_sessions` — id, tenant_id, device_id, opened_by → app_users, opening_float numeric(12,2), opened_at, closed_by, closing_count numeric(12,2), closed_at, expected_cash numeric(12,2), variance numeric(12,2), status check in ('open','closed').
- `business_settings` add: receipt_header_text, receipt_footer_text, receipt_logo_path (config for the 80mm thermal receipt).
- `documents.origin text` check in ('standalone','from_job') default 'standalone' (reporting: counter sale vs serviced job).

### Architectural rules — preserve these everywhere
1. **Inventory is event-sourced.** Never mutate a quantity. Every stock change is an INSERT into `stock_movements` (signed qty: + in, − out) with `ref_type`/`ref_id` pointing at its source (invoice, job_card, purchase_order, transfer, adjustment). On-hand = the `stock_on_hand` view.
2. **One `documents` table for quotes and invoices** (`doc_type`) with `document_lines`. Quote→invoice conversion copies the document, links via `source_document_id`, and draws from the invoice number series.
3. **`document_lines.product_id` is nullable by design.** A line is either a catalogue pick (auto-fills name/price/VAT, links stock) or a fully **ad-hoc typed line** (free multi-line description + its own price, touches no stock). Both coexist on one document. The owner can create a standalone quote or invoice at any time with no job, no intake — type anything, charge anything.
4. **Gapless numbering seam.** One atomic function assigns numbers on **issue** (not draft) from `business_settings`: quotes prefix `A`, zero-padded 5 digits (`A00116`); invoices `INV-` + sequence. Keep it behind a single interface — it will later be swapped for MRA e-invoicing (IRN + QR) without touching callers.
5. **Fiscal lock.** Quotes are fully free-form. Invoices always render: legal name, BRN, VAT number, invoice number, issue date, customer, lines, VAT breakdown, total. Templates customize around these; they can never be removed or hidden on an invoice.
6. **`tenant_id` on every row + RLS on every table.** One tenant today; this becomes a multi-tenant product.
7. **Payments are children of the invoice document** — many per invoice (split payments). Methods: cash (tendered + change), card, juice, bank_transfer (each with external_ref from the bank's own terminal — this app never processes card payments, only records them). `SUM(payments)` drives status paid / partly_paid.

## Seed data (Phase 0)
One tenant. `business_settings`: Carfectionist, Mauritius, BRN `C22190760`, VAT `VAT28070619`, email `carfectionist@gmail.com`, phone `+230 5258 8854`; bank: Diamondbrite Reunion (Mauritius) Ltd / 000449884716 / MCB; VAT 15% exclusive; series `A` (quotes, next 116) and `INV-` (invoices, next 1). Catalogue: ~10 services — incl. Full Decontamination & Body Polish Rs 32,000; Remove Wheel, Decontamination & Polish Rs 3,800; Diamondbrite 3-Year Protection (Exterior Only) Rs 30,000; plus tint, PPF, wash tiers — and ~15 products/consumables with realistic units (ml, m², piece), cost prices, and barcodes on a few. Two stock locations (Storeroom, Shop Floor) with opening stock via `adjustment` movements. Users: 1 owner, 1 cashier, 3 technicians. Five customers with vehicles (Mauritian plates like `1234 AB 26`).

## The Diamondbrite document template — implement exactly (Phase 1)
The client's existing format; one template renders both quotes and invoices:
- **Header:** full-width dark banner image slot ("Covered by Diamonds" artwork) + Diamondbrite logo top-right. **Footer:** full-width "Diamondbrite forever" banner image slot. Both configurable in template settings.
- Title "Quotation"/"Invoice" per doc_type, small trading name beneath. Meta rows: number, date, Created By.
- Two boxes: **From** (legal name, country, BRN, email, phone, VAT number) and **For** (customer name, country).
- Line table, dark header, columns exactly **Item / Quantity / Rate / Amount**. Item cell = bold title + optional multi-line detail beneath. No discount/VAT columns displayed.
- Totals right-aligned: **VAT**, then **Total (MUR)**. Left of totals: **Total (in words):** uppercase amount in words — implement a MUR number-to-words utility (e.g. `EIGHTY EIGHT THOUSAND SEVEN HUNDRED EIGHTY RUPEES ONLY`).
- **Bank Details** section (account name / number / bank), togglable. **Terms and Conditions** numbered list from template config (defaults: "1. Quotation is valid for 5 days." / "2. Interest at a rate of 2.5% per month will be charged on overdue amounts after 14 days from the invoice due date").
- **Verification:** 1× Rs 32,000 + 4× Rs 3,800 + 1× Rs 30,000 → subtotal 77,200, VAT 11,580, **Total Rs 88,780.00**. The renderer must reproduce this document.

## Design language (both surfaces)
Dark, premium, automotive-grade: deep graphite/charcoal surfaces, one electric-teal accent (ceramic-coating iridescence), sharp typography. Not a generic Material admin look. Web = power-user dense (tables, filters, keyboard-friendly). Tablet = touch-first (big targets, few taps, minimal typing). Same brand, two contexts.

---

# PHASES — follow the checklist in order

## Phase 0 — Foundation (web)
- Supabase project; migrations 0001 + 0002; RLS on every table; seed data above.
- Next.js scaffold, Supabase client + generated types, email/password auth with role from `app_users`, protected routes.
- Dark app shell with sidebar: Dashboard, Contacts, Sales & Invoices, Products & Inventory, Purchases & Expenses, Accounting & Reports, Forms & Enquiries, Team & Settings.

**DoD:** I can log in and see the shell; `select * from stock_on_hand` returns seeded rows; a cashier login exists.

## Phase 1 — The money path (web) — highest priority
- Documents list: quotes + invoices, filters (type, status, date, customer).
- **Document builder** (the centerpiece): create quote or invoice from scratch; add catalogue lines and typed ad-hoc lines; qty/unit price/optional per-line discount; live subtotal, 15% VAT, total; custom fields from template config; section toggles (bank details, terms, signature); live preview.
- Template save + set default; the Diamondbrite template above as the seeded default for both doc types.
- Numbering on issue (gapless, atomic). Quote→invoice conversion. PDF download at every step.
- Record payments: cash (tendered/change), card/juice/bank_transfer (external ref), split payments, auto status.

**DoD:** I can rebuild the exact Rs 88,780 Diamondbrite quote, issue it as `A00116`, convert to `INV-0001`, record a split Rs 50,000 card + Rs 38,780 cash payment, and the invoice shows **paid** — with a faithful PDF at each step.

## Phase 2 — Surrounding organs (web)
- Customers + vehicles CRUD; customer detail with vehicles + document history. Suppliers CRUD.
- Catalogue CRUD **including `barcode`**; on-hand per location; low-stock flags; movements list; manual adjustments.
- **Stock transfers**: draft → dispatched → received; qty_received vs qty_dispatched (gap = in-transit loss); paired `transfer_out`/`transfer_in` movements.
- Issuing an invoice with stocked products fires `sale` movements automatically.
- Payments register with **method + date-range filters**. Dashboard: today's turnover, collected by method, outstanding, best-sellers. Expenses CRUD (category, amount, VAT amount, paid/due).

**DoD:** issuing an invoice with a stocked product visibly drops on-hand; a storeroom→floor transfer shows correctly at both locations; the payments register filters cash-only for a date range.

## Phase 3 — Finish for client hands (web)
- **Accounting workspace** (the owner's top priority): every report filterable by date (day/week/month/custom/financial year), payment method, customer, service/category, technician, invoice status, VAT. Views: collected-by-method over any range + mix over time; **end-of-day cash-up** (cash vs card vs Juice vs bank, joined to `cash_sessions` when present); aged receivables; **VAT report** (output VAT on invoices − input VAT on expenses/purchases); simple P&L (revenue − COGS from movements' unit_cost − expenses); per-customer statements; best-sellers; revenue by technician. Surface cash-received vs revenue-invoiced as distinct. **CSV + PDF export on every report.** No double-entry ledger.
- Credit note / void flow. Role-gated UI (owner/manager/cashier/technician/accountant — cashier cannot see accounting).
- Purchase orders: create → receive (fires `purchase` movements with unit_cost). Service recipes CRUD (BOM per service, expected_qty in consumption units).
- Certificates: issue ceramic certificate (number, product used, warranty months, expiry, PDF); warranty list + maintenance reminders.
- Minimal public enquiry form → enquiry inbox → convert to customer/vehicle.
- Deploy to Cloudflare Pages + Supabase prod.

**DoD:** end-of-day cash-up for a seeded day reconciles to seeded payments; VAT report matches a hand calculation; a cashier login cannot open accounting; every report exports.

## Phase 4 — Android POS
- Compose scaffold, landscape, same dark theme; Supabase Kotlin client; login.
- **Reception/Intake:** customer + vehicle lookup/create; photos via CameraX → Supabase Storage; tappable damage diagram (car outline, markers stored as JSON).
- **Quotation builder:** catalogue + ad-hoc lines, 15% VAT, convert accepted quote → job.
- **Jobs board + job cards:** status board (Scheduled/In progress/Ready/Delivered); per-card technician, start/stop timer, checklist (from per-service templates), before/after photos. Completing a card pre-fills its service recipe quantities for the technician to confirm/adjust, then fires `consumption` movements with unit_cost.
- **Checkout:** invoice summary; split payments; quick **counter sale** (walk-in products, no job, origin 'standalone').
- **Hardware:**
  - *Thermal printing:* 80mm ESC/POS (Bluetooth/USB/Ethernet). Receipt layout: logo raster → business name, BRN, VAT no, phone → number + datetime + cashier → item lines (ad-hoc lines print their typed text) → subtotal, VAT, TOTAL (MUR) → payment lines per method (cash: tendered + change; card/Juice: ref) → footer text → cut. Auto-print on sale; reprint from history. (The A4 PDF remains a separate, back-office document.)
  - *Cash drawer:* ESC/POS kick pulse (`ESC p`) through the printer's RJ11 port on completed cash payment; manual open is role-gated and audit-logged.
  - *Barcode scanner:* HID keyboard-wedge; global key listener on the sale screen buffers fast keystrokes ending in Enter, looks up `products.barcode`, adds the line; unknown barcode → quick-create prompt.
  - *Cash sessions:* open till (float) → close till (count) → variance = count − (float + cash payments in session); totals feed the back-office cash-up.
- **Offline fallback (backup mode, not primary):** local read cache (catalogue, customers, open jobs) + a local outbox queueing INSERTs (documents, payments, movements, photos) replayed on reconnect. Idempotency keys on queued writes. Persistent sync-status chip: `Online` / `Offline · N pending`.

**DoD:** full sale on the tablet — scan a product, add an ad-hoc line, take split cash+card payment, drawer kicks, receipt prints; then the same sale completed with wifi off replays cleanly on reconnect and appears in the back office.

## Phase 5 — Integration & shakedown
- Full flow: intake → quote → job → card completion (stock drops via recipe) → invoice → split payment → certificate — verified across both surfaces.
- Transfer storeroom→floor reflected on both. Outage drill (kill wifi mid-sale, complete, reconnect, verify replay, no duplicates). Cash-session over/short computed correctly on a simulated day. VAT report sanity check. Hardware drill: scan → line; cash → kick + print; reprint.

**DoD:** one simulated full shop day runs end-to-end with zero manual DB fixes.

---

## Working style
- Commit per feature, clear messages. Stop at each phase boundary with a test script; wait for my go.
- When ambiguity arises, ask — do not invent business rules. The schema doc and this prompt outrank any assumption.
- Never weaken the architectural rules (event-sourced stock, nullable product_id, fiscal lock, gapless numbering seam, RLS) for convenience.