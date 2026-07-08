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
- [~] **2 · Job → invoice** — a ready/delivered job's detail footer has "＋ Invoice": enter the service +
  amount → `create_document_from_job` → `save_draft` (prices the line, job link preserved) →
  `issue_document` (gapless INV#, VAT added) → toast "collect it in Checkout". The invoice then appears in
  the checkout TO COLLECT list. Double-billing blocked server-side. **Compiles; runtime-verify pending.**
- [~] **3 · Corrections** — wired `void_document`, `create_and_issue_credit_note`, `reverse_payment`.
  Collect pad on an unpaid invoice shows "Void this invoice" (owner/manager); a tapped PAID TODAY row
  opens Refund (credit note, restock) / Reverse-payment. RLS enforces owner/manager; graceful message
  otherwise. **Compiles; runtime-verify once fresh data is loaded.**
- [~] **4 · Certificate issuing** — a ready/delivered job's detail sheet now has "＋ Issue warranty
  certificate": pick a ceramic product + term (1/3/5/10 yr) → direct `certificates` insert (customer +
  vehicle from the job, next `CERT-####` computed client-side, applied/expiry dates set). It then shows on
  the Certificates screen. **Compiles; runtime-verify once fresh data is loaded.**
- [ ] **5 · Quote flows parity** — integrate `convert_quote_to_job` (in flight in a separate session)
  for proper accept→job; wire `convert_quote_to_invoice` + `revise_quote` where the web app offers them.
- [ ] **6 · Role-based UI gating** — hide tabs/actions the signed-in role can't use (web enforces RBAC;
  Android shows everything and fails at the RLS boundary).
- [ ] **7 · Offline outbox + sync** — the literal "in sync": queue writes locally, drain via WorkManager,
  extend the Room cache to all read screens with delta cursors. Large; the idempotent RPCs already support it.

## Ready-to-run, hardware-gated (code written, verified on device later)
- [ ] **Receipt printer (ESC/POS) + cash-drawer kick** transport behind the existing `ReceiptPrinter`/
  `CashDrawer` seams (currently log-only).
- [ ] **Barcode scanning (ML Kit/CameraX)** + **before/after photo capture** + `job_photos` upload.

## Polish
- [ ] Customer/vehicle **edit**; **held/parked** sales; broader **search** (jobs/quotes/stock/cert lists).
