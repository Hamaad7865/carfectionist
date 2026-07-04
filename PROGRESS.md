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
- [ ] 4. **Documents list (`/sales`)** — server-rendered table of quotes +
  invoices with filters (type, status, date, customer) via searchParams.
- [ ] 5. **Document builder** — `/sales/new` + `/sales/[id]/edit`: reducer
  state, catalogue ProductPicker + ad-hoc typed lines, qty / unit price /
  per-line discount, live subtotal + 15% VAT + total, section toggles + custom
  fields from template config, autosave via `save_draft`, live iframe preview,
  Issue, Convert quote→invoice.
- [ ] 6. **PDF pipeline** — `/print/doc/[id]` print route + `/api/documents/
  [id]/pdf` via Cloudflare Browser Rendering + issued-invoice snapshot to
  Storage. PDF download available at every step.
- [ ] 7. **Payments UI** — document detail (`/sales/[id]`): record cash
  (tendered/change), card/juice/bank_transfer (external ref), split payments;
  status auto-derived (paid / partly_paid) from SUM(payments).
- [ ] 8. **Template settings** — `/settings/templates`: edit the Diamondbrite
  template config, save, set default (both doc types).

## Notes log
_(one line per completed item)_
- 1. RPCs live + verified end-to-end via `scripts/verify-money-path.mjs` (77,200/11,580/88,780 → A00116 → INV-0001 → split → paid, fiscal lock rejects issued-line edits); run rolls back so the series stays at 116/1. Fixed a `text→doc_status` cast in the payment status CASE.
- 2. rpc.ts wrappers (the seam) + zod server actions (saveDraft/issue/recordPayment/convert); cents→rupees mapper unit-tested (5 tests). Build + 39 tests green.
- 3. DocumentA4 (Diamondbrite layout, inline styles, embedded print CSS) + fiscal-lock resolver; render test asserts Rs 77,200/11,580/88,780 + amount-in-words + column headers, and invoice keeps legal identity when config hides it. 50 tests green.
