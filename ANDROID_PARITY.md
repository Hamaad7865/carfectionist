# Android POS — parity with the web app

**Goal:** make the Android tablet POS a complete, in-sync counterpart to the Next.js web back office.
Every RPC below already exists server-side and is used by the web app — the Android app just doesn't
wire it yet. Scope decisions (2026-07-08): skip web deploy, third-party services (Sentry/messaging),
and MRA fiscalisation (studio is small / not in-scope). Hardware not on hand → printer/scanner/photo
code is written ready-to-run and verified later on a device; everything else is verified on the emulator.

Convention mirrors FRONTEND_PROGRESS.md: build → verify on emulator-5554 → commit → tick → log deviations.

## Backend fixes
- [x] **`reverse_payment` double-reversal guard** — `for update` + already-reversed check. Verified
  (1st reversal ok, 2nd raises "payment already reversed"). Commit `fix(money): guard reverse_payment`.

## Parity features (ordered by operational value)
- [x] **1 · Collect-on-invoice checkout** — checkout now opens on a **TO COLLECT** (outstanding invoices:
  issued/partly_paid, real remaining balance + UNPAID/PART-PAID chip) + **PAID TODAY** list, with "New
  counter sale — walk-in" toggling to the existing cart. Tapping a bill opens the payment pad for its
  balance (credit hidden) → `record_payment` on that document → moves to PAID TODAY. Verified on tablet:
  collected INV-0012 Rs 65,550 cash, invoice moved lists. Commit `feat(pos): collect-on-invoice checkout`.
- [x] **2 · Job → invoice** — a ready/delivered job's detail footer has "＋ Invoice": enter service +
  amount → `create_document_from_job` → `save_draft` (prices the line, job link preserved) →
  `issue_document` (gapless INV#, VAT added). **Verified on tablet: INV-0014 issued from a job (Rs 9,775 =
  8,500 + 15% VAT), then appeared in checkout TO COLLECT.** Double-billing blocked server-side.
  ⚠️ Data: a reseed must set `business_settings.invoice_next_number` = `max(existing)+1` or issue collides.
- [x] **3 · Corrections** — wired `void_document`, `create_and_issue_credit_note`, `reverse_payment`.
  Collect pad on an unpaid invoice shows "Void this invoice"; a tapped PAID TODAY row opens Refund (credit
  note, restock) / Reverse-payment. **Verified on tablet: the "Correct this payment" dialog renders with the
  payment context (INV-0001 · Rs 65,550) and both actions; reverse_payment RPC separately verified.**
- [x] **4 · Certificate issuing** — a ready/delivered job's detail sheet has "＋ Certificate": pick a
  ceramic product + term (1/3/5/10 yr) → direct `certificates` insert (customer + vehicle from the job,
  next `CERT-####` computed client-side). **Verified on tablet: CERT-0005 (3-year) issued from a job and
  linked to it; appears on the Certificates screen (refresh-on-entry).**
- [~] **5 · Quote flows parity**
  - [x] **Quote → invoice** — the quote builder footer has "Bill now — create invoice": persist the quote
    (`save_draft`), copy it into a draft invoice (`convert_quote_to_invoice`, priced lines carried over),
    then `issue_document` for a gapless INV#. Confirmation dialog → collect in Checkout. **UI verified on
    tablet (button renders, teal, below Accept). End-to-end money verification pending the DB reseed** — the
    transactional tables were wiped mid-session (see note below), so the cached quote's FKs no longer exist.
  - [BLOCKED] **Quote → job** — still needs `convert_quote_to_job` RPC (in flight in a separate session).
    Today "Accept → create job" makes a job but can't atomically link/mark the quote accepted without it.

> ⚠️ **DB state 2026-07-08 22:5x:** the user is reseeding. Live counts: `customers` 141, `products` 795,
> but `documents`/`document_lines`/`payments`/`jobs`/`vehicles`/`certificates` = **0**. The tablet shows
> **stale Room-cached** invoices/quotes/jobs that no longer exist server-side, so any money-path write that
> references them fails on missing FKs. Re-run the full money-path verification once fresh data lands.
- [DEFERRED] **6 · Role-based UI gating** — the Android auth model is mid-change to staff name+PIN (backend
  landed 2026-07-08, commit `2e4d1df`); role→tab policy + verification depend on that login. Revisit when
  the PIN login lands on Android so roles are real and testable (can't verify while signed in as sole owner).
- [ ] **7 · Offline outbox + sync** — the literal "in sync": queue writes locally, drain via WorkManager,
  extend the Room cache to all read screens with delta cursors. Large; the idempotent RPCs already support it.

## Ready-to-run, hardware-gated (code written, verified on device later)
- [ ] **Receipt printer (ESC/POS) + cash-drawer kick** transport behind the existing `ReceiptPrinter`/
  `CashDrawer` seams (currently log-only).
- [ ] **Barcode scanning (ML Kit/CameraX)** + **before/after photo capture** + `job_photos` upload.

## Sync / freshness ("every saved thing should appear")
- [x] **Refresh-on-entry** — Checkout, Jobs, Quotes, Stock, Certificates and Today now re-fetch when their
  tab becomes active (`LaunchedEffect`), so data saved on the web or another device shows without a
  restart. Verified: a job-issued invoice appeared in TO COLLECT on entering Checkout.

## Polish
- [ ] Customer/vehicle **edit**; **held/parked** sales; broader **search** (jobs/quotes/stock/cert lists).
