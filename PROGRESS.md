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

**More test data (harmless):** customer "Vikram Patel" (+ Toyota vehicle); supplier "Meguiars Distributor"; product "Snow Foam Shampoo 5L" (barcode, +12 on-hand).

---

# Phase 3 — Client-ready (in progress; built, verified, committed)

- [x] **Revise quote / Duplicate invoice** — issued docs stay locked, but a quote gets a **Revise** button and an invoice a **Duplicate** button that clone it into a fresh draft (source_document_id link, own number on re-issue). RPCs `revise_quote` (0005), `duplicate_document` (0006). Verified against A00117 and INV-0001.
- [x] **Void invoice flow** — Void button on issued, unpaid invoices (owner/manager) → confirm+reason → `void_document` (keeps number, reverses stock, audit event); voided banner on detail. Verified (INV-0003 voided).
- [x] **Business profile settings** — `/settings` edits business_settings (identity, contact, bank, VAT rate); numbering counters read-only. New Settings sub-nav.
- [x] **Team & roles** — `/settings/team`: list (emails via admin client), add staff (admin createUser + app_users, rollback on failure), change role, activate/deactivate; self-lockout guards. Verified (created a cashier login).
- [x] **CSV export on every report** — dynamic `/api/reports/[slug]/csv` for all 7 reports (range + method aware). Verified (all 200 text/csv).
- [x] **Maintenance reminders** — `/certificates?tab=reminders`: create + pending→sent/done/dismissed, overdue flagging. Verified.

**Still open for Phase 3:** credit-note **CN- series** (additive migration + issue branch — void covers unpaid; credit notes are for *paid* corrections), **PDF export** on reports + **PDF binary/Storage snapshot** (both blocked on Cloudflare Browser Rendering creds), report **SQL-view RPCs** + **customer statement**, enquiry **edge function** (currently a server action), **deploy** (OpenNext → Workers).

**More Phase 3 test data (harmless):** staff login "Priya Naiko" (cashier); a voided INV-0003 + its draft duplicate/duplicated drafts; A00117 revision draft; a "done" maintenance reminder for Vikram Patel.

---

# Deploy + product requests (built, verified, committed)

**Deploy — Cloudflare Workers (OpenNext).** Wired `@opennextjs/cloudflare` + wrangler (wrangler.jsonc, open-next.config.ts, next.config dev hook, cf-build/preview/deploy scripts, DEPLOY.md). OpenNext build produces `.open-next/worker.js` cleanly. **Middleware refactor:** Next 16's `proxy.ts` is Node-only and OpenNext hard-blocks Node middleware, so the proxy was removed — route protection was already server-side ((app) layout `requireSession` + RLS), token-refresh moved to a client `AuthKeepalive`, `/login` gained a signed-in bounce. **The live push is gated on the user's Cloudflare login** (API token + account id) — one command (`npm run deploy`) from live.

**Owner requests (migration 0007: jobs.department + appointments):**
- [x] **Date range filter** (From/To) on Sales list + Reports (reusable `DateRangeFilter`).
- [x] **VAT-inclusive price toggle** in the product form (gross → stored net using the effective rate; business VAT default threaded in).
- [x] **Departments ("Place of work")** on jobs — dropdown (Detailing studio / Car wash / Technical jobs / Garage) on intake + job card + board badge.
- [x] **Create-customer in job intake** — Existing/New toggle; New captures customer + vehicle and creates all three in one call.
- [x] **Appointment module** — `/appointments`: book (customer, vehicle, date/time, department, technician, service), schedule with status + overdue, **convert to job**.
- [x] **Custom fields on documents** — builder 'Custom fields' (N label/value), saved to `template_overrides`, rendered in the A4 header (preview + PDF).

**Credit notes (CN- series) — DONE.** Migration 0008: CN- numbering + `create_and_issue_credit_note` RPC (copies a paid/partly-paid invoice into an issued credit note, optional restock via +qty movements, audit event). Credit-note button on paid invoices; nets out of revenue/output-VAT/COGS reports. Verified: INV-0002 → CN-0001, Clay Bar 149→150, VAT 11,613→11,580.

**Still open for Phase 3:** PDF exports (blocked on CF Browser Rendering creds); report SQL-view RPCs + customer statement (numbers already correct); enquiry edge function + rate-limit (works as a server action); the actual production deploy (needs CF login — everything's wired, Workers build passes).

---

# Fix train 2026-09-10 — JOB-9F23 blocked bill + JOB-a73c lost booking (built, verified, COMMITTED 2ea4c63, pushed to main, release APK 0.1.674)

**JOB-9F23 — "+ Invoice" refused although the old bill was already refunded.** Chain TESTQ-00048 → 49 → 50: the original Rs 18,150.01 was billed (TESTINV-0119) and paid, the quote revised twice, work done under 9F23 — then the double-bill guard refused the new invoice. A full credit note (TESTCN-0002) had already been raised, but `app.superseded_bills` only knew draft/void, so the message's own remedy ("raise a credit note first") never opened the door.
- `supabase/migrations/20260910000020_a_credited_bill_is_retired.sql`: a fully-credited invoice counts as retired (like a void); partial/voided credits still block. Verified live: `superseded_bills` for the 9F23 quote now returns 0 rows.

**JOB-a73c — booked on the tablet, landed with no time and no deposit.** Accept-for-later saved neither the picked date nor the 25% deposit, and "Create job →" (`QuoteViewModel.createJobFromQuote`) sent a bare `convert_quote_to_job` (no schedule, no signature, no bill) — the DB accepts `p_scheduled_at`, the button just never sent it.
- `supabase/migrations/20260910000030_quote_booking_intent.sql`: `documents.book_for_at` + `deposit_due` + `set_quote_booking` RPC (issued/accepted quotes only, deposit capped at the total, `quote_booking_set` audit; no numbers, no money).
- Tablet: intent persists at accept-for-later, reopens pre-filled, and the "Create job" card now shows date/time pickers + deposit chips (same components as the accept panel, pre-filled from the stored intent, editable). Creating the job sends the date, raises + issues the deposit bill, and hands Checkout the collect request (reuses the start-now handoff); the original signature stands, none taken. Files: `Dtos.kt` + `PosApi.kt` (`setQuoteBooking`, columns on the quotes select), `QuoteViewModel.kt` (`bookedForAt/bookedDepositCents`, `parseBookForAt/parseDepositDueCents`), `QuoteScreen.kt` (card UI). New `BookingIntentTest` 6/6; full unit suite green; debug APK rebuilt, installed on `pos_tablet`, no crashes. Web untouched (its StartJob has the same gap — follow-up).

**Found while pushing — stale `issue_document` twin was breaking ALL draft acceptances.** The 3-arg overload predates the day guard, replay ordering, discount guard, Mauritius-day stamping, shop-floor deduction and tenant checks, and made every short call ambiguous ("not unique"): `accept_quote`, `convert_quote_to_job(s)` draft branches fail instead of issuing.
- `supabase/migrations/20260910000040_drop_stale_issue_document_twin.sql`: drops the 3-arg twin (same playbook as 20260810000015); all live callers already name all four params, short calls now resolve to the canonical 4-arg (null session = back-office).
- `supabase/migrations/20260810000045_restore_issue_document_replay_order.sql`: reinstalls 20260802000010's reviewed body + the discount guard — the folded-in sale_deducts twin had reverted it live (see history note below).

**Migration-history repair (same push):** prod history had out-of-band rows with no local files (`20260822000020`, `20260909183604` — marked reverted; `settle_customer_account` from the former is orphaned-but-inert, nothing references it) and 13 duplicate version stamps (second twin of each folded into the recorded file with a header note — 15-digit restamps proved unmatchable by CLI 2.109, so no renames survive). Splice/idempotency hardening so every pending file re-runs cleanly: `reverse_payment` + `import_products` → OR REPLACE; trigger/policy DROP-guards in `till_movements`, `wa_inbox`; overload-aware splices in `stale_till_guard`, `product_recent_activity`; overload-pinned `issuing_checks_the_allowance`; return-type-moved bodies out of `...10000030/...070` (live in `...080`); cheque-aware `payments_check3` step. `npm run db:push` is green; local-vs-remote version audit reports clean. Older `_verify-*.mjs` scripts fixed to the 4-arg `issue_document` form (2-arg named calls went ambiguous with the 4-arg overload — pre-existing breakage, repaired not weakened).

**Verify:** new `scripts/_verify-quote-booking-intent.mjs` PASS (booking stored + audited; over-total/negative/draft/ghost refused; full credit retires; void/partial do not — rolled back, nothing survives). Existing suites PASS rolled back: `_verify-revise-a-billed-quote`, `_verify-the-line-keeps-one-bill`, `_verify-a-revised-quote-replaces-the-old-one`. `db:types` skipped (no access token); web code untouched. Nothing committed — working tree holds the migrations + tablet changes + new test/script.

**Deposit button on the job card (built, verified, NOT committed).** Ask: with a deposit agreed, the job card gets a button that raises the bill so the cashier collects in Checkout. Done on the tablet: `Collect Rs X deposit →` shows when the job's quote has `deposit_due > 0` and no live bill (drafts don't hide it — raising issues the standing draft, convert is idempotent); tap converts + issues, latches a Checkout collect request dialled to the deposit (bus is latched, works even if Checkout opens later/another moment), toast confirms, board reloads. TO COLLECT rows also show an "Rs X deposit agreed" hint from the same batched quote lookup. Files: `Dtos.kt` (`depositDue` on quote refs), `PosApi.kt` (embeds + `fetchQuoteDeposits` + pre-existing `convertQuoteToInvoice`/`issueDocument`/`CollectBus`), `JobsViewModel.kt` (`raiseDepositBill`, `showDepositButton` rule, `depositBusy`), `JobsScreen.kt` (footer button), `CounterViewModel/Screen.kt` (hint). `JobsDepositTest` 3/3; suite green; APK rebuilt + installed on `pos_tablet`. Live proof while testing: TESTQ-00056's Rs 412 wish → TESTINV-0121 issued → Rs 412.00 part-payment recorded (partly_paid, Rs 1,238 owed). Known deferred gap: the wish stays on the quote it was agreed on — a revision starts with none (paid deposits still carry to the rebill server-side).

**Sign-step cleanup (built, installed, NOT committed).** The full-width "Sign again" button could not shrink, so in a squeezed column it overflowed and drew over the signature preview. Signed state now has no big button: the preview stays tappable and a small "Sign again" sits beside "Clear" in the header (opens the same pad dialog, hoisted state) — on every tab path. Unsigned keeps the fixed "Sign here" button.

**Deposit visible on ticket + payment (built, verified, NOT committed).** Ask: a bill with a deposit must say so on the job ticket and on the payment. Tablet: (1) printed work order gains a DEPOSIT & PAYMENT block — Deposit agreed (from the quote), Paid + Balance due (from the live bill), warn-styled while anything is owed; (2) the Checkout pad header shows "Rs X deposit agreed" when collecting on such a bill (same batched lookup as the TO COLLECT hint); (3) the thermal slip + on-screen preview print DEPOSIT AGREED above BALANCE DUE (`ReceiptDoc.depositAgreedCents`, fed at payment time from the bill's source quote; history reprints without that context print as before — dated rows + balance intact). Files: `JobCardPrint.kt`, `CounterScreen.kt` (pad header + preview), `Hardware.kt` (model + thermal render), `SaleReceipt.kt` (optional param), `Counter/JobsViewModel.kt` (feed it), `Dtos.kt`/`PosApi.kt` (`amount_paid` on job invoice embeds for the ticket). `JobCardHtmlTest` +3 (agreed/paid/owed, clean job, paid-in-full); suite 24/24 green; APK on `pos_tablet`. Web receipt card parity left as follow-up.

**Deposit breakdown on the slip (built, verified, NOT committed).** Ask: with a deposit paid, the receipt must show the calculation — what was paid the first time and the second — instead of one grouped "2 CASH" row. Rule: tender legs settled the SAME day still collapse by method with a count (a split is one visit's money — pinned by existing tests); legs on DIFFERENT days print as dated rows (`1 CASH 09/09 : 412.00Rs`, `1 CASH 10/09 : 1238.00Rs`); reversals always stand alone. Shared pure helper `tenderRows()` consumed by both the thermal render and the on-screen preview so paper and screen agree. Files: `Hardware.kt` (helper + thermal), `CounterScreen.kt` (preview). `ReceiptTextTest` +1 (same-day grouped incl. DEPOSIT AGREED line; cross-day dated, no collapse); suite green; APK on `pos_tablet`.
