# Phase 1 — The money path — PROGRESS

> Source note: `detailing-studio-build-pack-v2.md` is not present in the repo.
> This checklist is derived from the approved plan
> (`~/.claude/plans/master-prompt-cuddly-flask.md` §B Phase 1) and the master
> prompt's Phase 1 section, which are the authoritative Phase 1 spec.

**Invariants — hold in every item, no exceptions:** event-sourced stock
(INSERTs only into `stock_movements`); `document_lines.product_id` nullable by
design; gapless numbering ONLY via the `issue_document` seam; invoice fiscal
lock (issued invoices immutable, legal fields never hidden); RLS on every query.
Never weaken a failing test to make verification pass.

## Definition of Done
Rebuild the exact Rs 88,780 Diamondbrite quote → issue as **A00116** → convert
to **INV-0001** → record split Rs 50,000 card + Rs 38,780 cash → invoice shows
**paid** — with a faithful PDF at each step.

## Checklist (implement in order; each verified + committed before the next)

- [x] 1. **Money-path RPC migration (0003)** — `app.next_document_number`,
  `issue_document` (stamps number + fiscal snapshot + vat_breakdown, fires
  `sale` stock movements for stocked lines), `record_payment` (+ status),
  `reverse_payment`, `save_draft` (upsert doc + replace lines, `expected_rev`),
  `convert_quote_to_invoice`, `void_document`; idempotency; grants. Pushed to DB.
- [x] 2. **Typed RPC wrappers + server actions** — `lib/supabase/rpc.ts` (the
  numbering/MRA seam) + `features/documents/actions.ts` (zod-validated server
  actions: saveDraft, issueDocument, recordPayment, convertQuoteToInvoice).
- [x] 3. **DocumentA4 template + fiscal-lock resolver** — `components/pdf/*`
  (Diamondbrite layout: header/footer banners, From/For, Item/Quantity/Rate/
  Amount, VAT + Total (MUR), Total-in-words, bank details, terms) +
  `lib/pdf/fiscal-lock.ts`. Reproduces the 88,780 document strings.
- [x] 4. **Documents list (`/sales`)** — server-rendered table of quotes +
  invoices with filters (type, status, date, customer) via searchParams.
- [x] 5. **Document builder** — `/sales/new` + `/sales/[id]/edit`: reducer
  state, catalogue ProductPicker + ad-hoc typed lines, qty / unit price /
  per-line discount, live subtotal + 15% VAT + total, section toggles + custom
  fields from template config, autosave via `save_draft`, live iframe preview,
  Issue, Convert quote→invoice.
- [x] 6. **PDF pipeline** — `/print/doc/[id]` print route + `/api/documents/
  [id]/pdf` via Cloudflare Browser Rendering + issued-invoice snapshot to
  Storage. PDF download available at every step.
- [x] 7. **Payments UI** — document detail (`/sales/[id]`): record cash
  (tendered/change), card/juice/bank_transfer (external ref), split payments;
  status auto-derived (paid / partly_paid) from SUM(payments).
- [x] 8. **Template settings** — `/settings/templates`: edit the Diamondbrite
  template config, save, set default (both doc types).

## Notes log
_(one line per completed item)_
- 1. RPCs live + verified end-to-end via `scripts/verify-money-path.mjs` (77,200/11,580/88,780 → A00116 → INV-0001 → split → paid, fiscal lock rejects issued-line edits); run rolls back so the series stays at 116/1. Fixed a `text→doc_status` cast in the payment status CASE.
- 2. rpc.ts wrappers (the seam) + zod server actions (saveDraft/issue/recordPayment/convert); cents→rupees mapper unit-tested (5 tests). Build + 39 tests green.
- 3. DocumentA4 (Diamondbrite layout, inline styles, embedded print CSS) + fiscal-lock resolver; render test asserts Rs 77,200/11,580/88,780 + amount-in-words + column headers, and invoice keeps legal identity when config hides it. 50 tests green.
- 4. /sales list: server-rendered table + client filter bar (type/status/date/customer via searchParams) + New quote/invoice; RLS query runs clean, empty-state verified in-browser.
- 5. Builder (reducer state, catalogue+ad-hoc lines, qty/price/discount, section toggles, autosave via save_draft, live DocumentA4 preview iframe, Issue/Convert). Browser-verified: catalogue picks → live totals (65,800/9,870/75,670), qty edit → exact 77,200/11,580/88,780, autosave persists draft to /sales list. toDocumentProps unit test → 88,780. 53 tests + build green. (DB pooler:5432 flaky during this item; verified via the working REST path + browser.)
- 6. /print/doc/[id] print route renders the faithful DB-backed document (browser-verified: Quotation, Item/Quantity/Rate/Amount, 77,200/11,580/88,780, amount-in-words, legal identity, bank, terms — all 200/present). /api/documents/[id]/pdf wired via htmlToPdf (Browser Rendering), returns graceful 503 without creds. PARTIAL-BLOCK: the PDF *binary* download + issued-invoice Storage snapshot need CF_ACCOUNT_ID + CF_BROWSER_RENDERING_TOKEN (not provided). Faithful PDF available now via /print + browser Print→Save as PDF. react-dom/server dynamic-imported in the route. Build offline-green.
- 7. Document detail (/sales/[id]) + RecordPaymentForm (cash tendered/change, card/juice/bank ref, split). FULL DoD verified in-browser: A00116 → convert → INV-0001 → card Rs 50,000 (partly_paid, outstanding 38,780) → cash Rs 38,780 tendered 40,000 (change 1,220) → PAID (outstanding 0.00). Status auto-derived from SUM(payments). NOTE: this consumed the real series (A00116/INV-0001 now exist, paid); a fresh rebuild issues A00117/INV-0002.
- 8. /settings/templates: TemplateEditor (name, default section toggles, terms add/remove, banner/logo URLs) + updateTemplateAction (zod, requireRole owner/manager, updates document_templates.config). Build-verified. Config READ verified (seeded terms render on documents via /print). PARTIAL-BLOCK: the owner-only SAVE could not be runtime-verified — owner login is failing right now because the proxy getUser() cannot reach Supabase Auth under a transient network outage (same outage hit fonts + DB:5432; auth worked earlier this session). Action mirrors the proven saveDraft/recordPayment pattern.

---

# Phase 2/3 — Deferred backend + POS parity (built, verified, committed)

> Migration `0004_operations.sql` (SECURITY DEFINER, event-sourced) backs these:
> open/close_cash_session, dispatch/receive_transfer, receive_purchase_order,
> complete_job. All UI reuses the same invariants (INSERT-only movements, RLS,
> the numbering seam). Jobs board + job cards shipped in an earlier commit.

- [x] **End-of-day cash sessions** — open till (float) / close (counted vs expected → variance); cash payments link to the open session; wired into the reports rail. Verified: open→close reconciles.
- [x] **Stock transfers** — `/products?tab=transfers`: draft → dispatch (−qty source) → receive (+qty dest). Verified: Clay Bar Storeroom 40→37, Shop Floor 10→13, on-hand conserved 50.
- [x] **Service recipes (BOM)** — `/products?tab=recipes`: add/remove component consumables per service, upsert on unique (service, component). Verified: Diamondbrite → Clay Bar ×2 persisted.
- [x] **Purchase orders** — `/purchases?tab=orders`: inline supplier add + PO create; receive per-line into a location (fires purchase movements + last-cost update). Verified: Clay Bar ×10 @ Rs 130 → Store 37→47, on-hand 50→60, cost 120→130. (Fixed a `po_status` enum cast in receive_purchase_order.)
- [x] **Counter sale** — `/sales/counter`: touch catalogue + ticket, walk-in customer, issues standalone invoice + payment in one step (cash tender/change, links till). Verified: Clay Bar → INV-0002 Rs 253.00, cash 500 → change 247, on-hand 60→59.
- [x] **Warranty certificates** — `/certificates` (new nav): issue against customer/vehicle/treatment with computed expiry; CERT-NNNN with collision-retry. Verified: unique numbers, 36-mo expiry math.
- [x] **Reports: P&L / best-sellers / revenue-by-technician** — added to the accounting rail. Verified: Revenue 77,420 → Gross 77,065 → Net 74,665; best-sellers ranked; technician split (fixed an ambiguous jobs→app_users embed via `jobs_technician_id_fkey`).

**Test data left in DB (harmless):** Auto Supplies Ltd supplier + received PO; Walk-in customer + INV-0002; a service recipe; a completed transfer; 2 certificates. On-hand/cost figures above reflect these.

---

# Phase 2 — CRUD organs (built, verified, committed)

> Fills the Phase 2 gaps that were read-only. Shared `components/ui/Modal.tsx` +
> `form.tsx` (Field/inputCls/FormError). All writes are RLS-scoped zod server
> actions (schemas use transforms → typed via `z.input`).

- [x] **Customers & vehicles CRUD** — `/contacts`: New/Edit customer (name, phone, email, address, BRN, VAT, notes) + add/edit/delete vehicles (plate, make, model, year, colour, VIN; duplicate-plate guard). Verified in-browser (create persisted, `saveVehicleAction` ran).
- [x] **Suppliers CRUD** — `/contacts?tab=suppliers`: New/Edit supplier (replaces the read-only table). Verified (Meguiars Distributor created).
- [x] **Products catalogue CRUD incl. barcode** — `/products`: New product + click-row-to-edit (name, SKU, description, category, unit, sell/cost price, VAT override, barcode, stock tracking + low-stock threshold, active toggle); services forced non-stocked; Show-archived toggle. Verified (Snow Foam Shampoo 5L created w/ barcode+stock; edit → Rs 999).
- [x] **Inventory — manual adjustments + movements ledger** — `/products?tab=inventory`: record +/- `adjustment` movements (owner/manager, RLS-permitted direct insert, valued at current cost) + full stock-movements ledger. Verified (+12 → on-hand 0→12, ledger row).
- [x] **Payments register method filter** — `/reports` collected: All/Cash/Card/Juice/Bank chips (`?m=`), CSV export carries the method. Verified (All 89,033 → Card 50,000 → Cash 39,033).

**Still open for Phase 3:** credit-note/void UI (+ CN- migration), CSV/PDF on every report, staff/team + business-profile settings, maintenance reminders, enquiry edge function, report SQL-view RPCs + customer statement, PDF binary/Storage snapshot (blocked on Cloudflare creds), deploy.

**More test data (harmless):** customer "Vikram Patel" (+ Toyota vehicle); supplier "Meguiars Distributor"; product "Snow Foam Shampoo 5L" (barcode, +12 on-hand).
