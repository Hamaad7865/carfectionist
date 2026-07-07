# Carfectionist — Android Tablet POS Build Plan (Phase 4)

_Status: proposed · Author: build team · Target: Android tablet POS for the shop floor_

## 0. The one-line goal

A **native Android tablet POS** for the counter that is **fast** (2–3 taps to take a cash payment), **works offline**, prints receipts, kicks the cash drawer — and shares the **exact same Supabase backend** as the web back office, so every sale, payment, and stock movement reflects in the web app instantly (online) or the moment the tablet reconnects (offline).

This is **not** a new system. It's a second, touch-first client on top of the backend that is already built and hardened. That is the single biggest de-risker in this whole plan.

---

## 1. What's already done (why this is lower-risk than it looks)

The POS does **not** need new business logic on the server. Everything it does, the web app already does through the same functions:

- **The money path is built and proven** — `issue_document`, `record_payment`, `convert_quote_to_invoice`, `void_document`, `create_and_issue_credit_note` all exist, are tenant-scoped, and are exercised daily by the web app.
- **Idempotency is already wired** — `issue_document` and `record_payment` take an `p_idempotency_key`. This is the exact seam the offline outbox needs to replay a queued sale **exactly once**. We hardened this in the recent audit; the POS gets it for free.
- **Gapless numbering is a single seam** (`app.next_document_number`) shared by both clients — a POS invoice and a web invoice draw from the same `INV-####` series with no collisions.
- **Stock is one event-sourced ledger** — a POS sale writes the same `stock_movements` the web Inventory reads.
- **Operations RPCs exist** — `complete_job`, `open_cash_session`, `close_cash_session`, `create_job`, `dispatch_transfer`, `receive_transfer`.
- **The checkout UX is designed** — the Claude Design mockup (`Detailing POS.dc.html`) specifies the fast payment pad down to the tap. See §7.

**So the POS is a native front-end over a finished, tenant-safe API.** The new work is: the Kotlin app, the offline cache/outbox, the printer/drawer/scanner integration, and one additive DB migration for sync metadata.

---

## 2. Architecture (locked in the master plan §C)

| Concern | Decision |
|---|---|
| Module | Single Gradle module `mu.carfection.pos`, package-by-feature |
| Pattern | MVVM + Repository, unidirectional data flow (UDF) |
| **Source of truth for reads** | **Room** — the UI always reads from Room, never directly from network. Same code path online and offline. |
| DI | Hilt (+ `@HiltWorker`) |
| UI | Jetpack Compose + Navigation (type-safe routes), Material 3 |
| Backend client | `supabase-kt` v3 BOM (auth + postgrest + storage) over ktor-okhttp |
| DTOs | kotlinx.serialization, hand-mirrored from the generated TS types (no Kotlin generator exists — drift caught in review + shared VAT test vectors) |
| Background work | WorkManager (outbox drain, photo upload, delta sync) |
| Local prefs | DataStore |
| Camera | CameraX (intake/damage photos) |
| Printing | DantSu ESCPOS-ThermalPrinter as **transport only**; our own pure `ReceiptBuilder` |

**Data flow:** `UI (Compose) → ViewModel → Repository → { Room (read), Outbox (write), supabase-kt (sync) }`. Writes never block the UI on the network — they commit to Room + enqueue in the outbox, and WorkManager drains them.

---

## 3. How the POS talks to the backend (no re-implementation)

The POS calls the **same RPCs** the web app does. It never gets the service-role key — it uses the **anon key + the logged-in user's session** (RLS enforces the tenant boundary exactly as on the web).

| POS action | Backend call (already exists) |
|---|---|
| Log in | Supabase Auth (email/password) → session |
| Build a walk-in sale | `save_draft` (draft invoice) |
| Take payment / finish sale | `issue_document(doc, location, **idempotencyKey**)` → `record_payment(..., **idempotencyKey**)` |
| Put on account (credit) | `issue_document` only, no payment (balance = receivable) |
| Open a job → quote → invoice | `create_job`, `create_document_from_job`, `convert_quote_to_invoice` |
| Complete a job (consume stock) | `complete_job` |
| Open / close the till | `open_cash_session`, `close_cash_session` |
| Void / credit an invoice | `void_document`, `create_and_issue_credit_note` |
| Manual drawer open (no sale) | insert `audit_events` (drawer-open) — visible in the web app |

**New server work is minimal** — only migration 0003 (§5) for sync metadata. Everything else is reuse.

---

## 4. Offline-first sync (the hard part, already de-risked by idempotency)

### 4.1 Read cache (Room)
Cache the tables the counter needs: `products` (indexed by barcode), `services`, `service_recipes`, `customers`, `vehicles`, `jobs`, `job_cards`, `app_users`, recent `documents`/`document_lines`/`payments`, `cash_sessions`, checklist templates, plus per-table `sync_state` cursors.

**Delta pull:** on connect / periodically, fetch rows where `updated_at > cursor` (needs migration 0003 to add `updated_at` + soft-delete to POS-cached tables). The UI renders from Room, so it's instant and works offline.

### 4.2 Write outbox (Room)
Every write is a seq-ordered outbox row: `{ kind, entity_id, payload_json, target_rpc, idempotency_key (unique), depends_on, attempts, backoff, status: PENDING|IN_FLIGHT|DONE|FAILED|BLOCKED }`. Client-generated UUID PKs everywhere.

**Drain (WorkManager):** FIFO by seq, `Mutex`-guarded, exponential backoff. Because every RPC is idempotent, a replay that the server already processed returns the **canonical stored result** (not a duplicate) — `already_processed → DONE`. Permanent failures land in a **"Needs attention"** list, never silently dropped. Photos drain on a separate queue.

### 4.3 Offline sale
- Commit locally as `PENDING_ISSUE` with provisional ref `PRV-{device}-{seq}`.
- Print a receipt headed **"PROVISIONAL RECEIPT — NOT A VAT INVOICE"** with that ref. **Cash only while offline.**
- On reconnect, the outbox replays `issue_document` with the same idempotency key → gets the **real `INV-####`** number. History then shows `INV-0001 (was PRV-T1-000042)` and offers a reprint.
- **Online sales call the RPC directly** (10s timeout) so the final receipt carries the real number; on timeout, the same key falls into the outbox — no double-charge.

### 4.4 Sync status
A persistent chip = `combine(network, outboxCount, photoCount)`: `Online` / `Offline · N pending` / `Syncing N…` / `All synced`.

---

## 5. Migration 0003 (additive, ships at the start of Phase 4)

Everything here is **additive** — it does not touch existing behavior:

1. **Delta-sync metadata** — `updated_at` (with the shared trigger) + `deleted_at` soft-delete on every POS-cached table, so the tablet can pull only what changed and tombstone deletes.
2. `documents.provisional_ref` + `documents.created_at_client` — to reconcile offline sales with their provisional receipts.
3. **`devices`** table (device_id, label, registered_by) + `cash_sessions.device_id` registration — one open till per device.
4. **Checklist templates** table (if not modeled by then) so job checklists are configurable.
5. **Drawer-open audit** — a small helper/RPC to insert a `audit_events` row of type `cash_drawer_open` (actor, time, reason), so the web app can show a "Cash drawer activity" log.
6. (Deferred, optional) JWT claims hook for tenant/role — only if profiling shows the per-request `app_users` lookup is a bottleneck.

---

## 6. Screens (from the design spec + master prompt)

The design mockup defines a 7-screen POS on a 1280×800 landscape tablet: fixed header (sync pill + staff chip) + left nav rail + swappable main area.

| Screen | Purpose | Backend |
|---|---|---|
| **Login / PIN switch** | Auth once; quick PIN to switch cashier | Supabase Auth; staff PINs (local, role-gated) |
| **Jobs board** (home) | Kanban: Scheduled / In progress / Ready / Done; tap → detail sheet (timer, checklist, before/after photos) | `jobs`, `job_timers`, `job_photos`, `complete_job` |
| **Intake wizard** | Customer → vehicle → damage markers → CameraX photos → "Start quotation" | `create_job` / `save_draft` |
| **Quote builder** | Add service/product lines, discounts, accept → job w/ technician + start time | `save_draft`, `convert_quote_to_invoice` |
| **Checkout** ⭐ | Collect payment on job invoices **and** counter (walk-in) sales — the fast payment pad (§7) | `issue_document`, `record_payment` |
| **Till** | Open float, close + count, variance | `open_cash_session`, `close_cash_session` |
| **Stock** | On-hand grid, ±1 quick adjust, Adjust… modal | `stock_on_hand`, adjustment movements |
| **Certificates** | Ceramic certificate + maintenance schedule | `certificates`, `maintenance_reminders` |
| **Today** (dashboard) | KPIs, 7-day turnover, best sellers, technicians, payment mix | read cache |

**Branding:** the mockup is a generic teal placeholder ("Apex Detail Studio"). We ship it in the **Carfectionist** identity (the gold-C monogram + dark brand), consistent with the web app and the printed documents.

---

## 7. The checkout / payment flow ⭐ (the reason for this POS)

This is the exact fast flow specced from the design, and the direct answer to the Cashmag "too many clicks" pain.

**The payment pad** (a sheet over the checkout), for settling an invoice or a counter sale:

- Opens **pre-filled**: method = **Cash**, amount = the **exact balance due**, tender mirrors the amount (so change = 0 and it's already valid).
- **Method chips:** Cash · Card · Juice · Bank · (Credit = on-account). Text, touch-sized.
- **Cash:** big **TENDERED** + big green live **CHANGE**; **quick-tender chips** (`Exact` + smart round-ups above the total — better than the mockup's fixed 200/500/1000/2000 for our large tickets) + an **on-screen numpad** (`1–9 . 0 ⌫`). **No OS keyboard** — that's what covered half the screen in the old system.
- **Card / Juice / Bank:** a reference field (optional) — "run it on the terminal/app first; the POS records the reference."
- **Complete** button: `Record Rs {amount}`.

**Tap counts:**
- **Exact cash → 2 taps** (open pad → Complete).
- **Cash with change → 3 taps** (open → tap a tender chip → Complete; change shows live).
- **Card → 3 taps** (open → Card → Complete).

**On a completed cash payment:** print the receipt **and** fire the drawer kick (`ESC p`) — automatically, no extra tap. Split payments = record more than one payment against the same invoice until the balance is zero.

---

## 8. Printing & the cash drawer

- **DantSu ESCPOS** as BT/USB/TCP **transport only**. Receipt bytes come from our own pure `ReceiptBuilder(ReceiptModel) → ByteArray` (ESC/POS), with **golden-byte unit tests** so a layout change can never silently corrupt a receipt.
- Logo raster (`GS v 0`), layout per spec, cut (`GS V`).
- **Drawer kick** (`ESC p`) appended to **cash** receipts.
- **Sale commits before printing** — a printer/paper failure can **never** lose a sale.
- **Manual drawer open** ("no sale"): role-gated, and writes an `audit_events` row → shows in the web app's drawer-activity log.
- Single-actor `PrinterManager` (no interleaved jobs).

---

## 9. Barcode scanning

Two supported inputs, pick per hardware:
- **Hardware wedge scanner** (most POS tablets): an Activity `dispatchKeyEvent` burst detector (inter-key ≤ 45ms, ≥ 4 chars, Enter-terminated) → lookup in Room by barcode → add line. Unknown code → quick-create (manager) or ad-hoc line (cashier).
- **Camera** (ML Kit) fallback if there's no wedge scanner.

---

## 10. Security

- **No service-role key in the app, ever.** Anon key + user session only; RLS is the real boundary (same as web).
- Staff switch via PIN (local), role-gated actions (manual drawer, voids, price overrides).
- Device registration so a lost tablet can be de-authorized.
- The idempotency keys we hardened prevent an offline replay from ever double-charging.

---

## 11. Milestones (suggested build order)

Each milestone is independently demoable and ends with a STOP + test.

- **M1 — Skeleton + the money path (online).** App shell, auth, Room read cache + delta pull, **Counter sale → payment pad → receipt + drawer**, till open/close. _This alone replaces the daily counter workflow._ DoD: ring a cash sale on the tablet → it prints, drawer kicks, and the invoice + stock drop appear in the web app.
- **M2 — Offline + sync.** Outbox, provisional receipts, WorkManager drain, replay → real number, "Needs attention" list, sync chip. DoD: airplane-mode a sale → provisional receipt → reconnect → real `INV-####`, no duplicate.
- **M3 — Jobs.** Jobs board, intake wizard (customer/vehicle/damage/CameraX), quote builder, job card (timer/checklist/photos), complete → consume stock. DoD: full intake → quote → job → invoice on the tablet.
- **M4 — Rest of the organs.** Stock adjust, certificates, Today dashboard, split payments, credit/void, polish + Carfectionist theming.
- **M5 — Hardening & shakedown.** Golden-byte receipts, offline stress, real-hardware testing, staff training.

---

## 12. Testing

- **Golden-byte receipt tests** — exact ESC/POS bytes per receipt type.
- **Shared VAT test vectors** — the same `docs/vat-test-vectors.json` the web app uses (the 88,780 fixture) so both clients agree to the cent.
- **Outbox replay / idempotency** — a queued sale replayed twice yields one invoice, one payment.
- **Offline scenarios** — mid-sale disconnect, drain ordering, dependency (`depends_on`) correctness.

---

## 13. Decisions needed from you

1. **Hardware** — which tablet, printer, cash drawer, and barcode scanner? (Model + connection: BT / USB / built-in.) This drives the printing + scanning integration. The photos suggest an all-in-one POS tablet with a built-in printer — please confirm the make/model.
2. **First milestone scope** — start with **M1 (counter sale + payment + drawer)** as the usable MVP, then layer the rest? (Recommended.)
3. **Staff PINs** — who gets a POS login + PIN, and which roles can open the drawer manually / void / override price?
4. **Provisional-receipt wording & VAT** — confirm the offline receipt disclaimer and that offline = cash-only is acceptable.

## 14. What I need to start building

- The **tablet + printer/drawer/scanner** in hand (or exact models) for M1.
- The Supabase **anon key** (public — already available) wired into the app.
- Confirmation of the **milestone order** above.

---

## 15. M1 — confirmed scope & kickoff

**Decision:** build **M1 first** (counter MVP), then layer M2+ later.

**M1 delivers (hardware-independent core, buildable now):**
- App shell + Carfectionist theme, Supabase auth (email/password) + quick staff switch.
- Room read cache of `products` (indexed by barcode + **name**), `customers`, `stock_locations`, `business_settings`; delta pull.
- **Counter sale screen** with a **product search bar** (type to filter by name or barcode — required) + category browse + tap-to-add cart + qty steppers.
- **Fast payment pad** (§7): pre-filled Cash, quick-tender chips + on-screen numpad, live change, Card/Juice/Bank reference, Credit (on-account with customer pick). 2–3 taps.
- **Till** open float / close + count / variance.
- Calls `issue_document` + `record_payment` (with idempotency keys) — online path first.

**Hardware is separate & TBD** (tablet + printer + drawer + scanner all standalone). So in M1 the hardware touchpoints sit behind interfaces and are stubbed until models are confirmed:
- `ReceiptPrinter` interface (impl = DantSu, later) — M1 logs/preview the receipt bytes.
- `CashDrawer` interface (impl = `ESC p` via printer, later).
- `BarcodeSource` interface (impl = wedge `dispatchKeyEvent` or ML Kit camera, later) — M1 uses the search bar for entry.

This lets M1 be built and demoed on any tablet now; the drawer/printer/scanner drop in when the hardware arrives with zero rework to the sale logic.

### Appendix — dependencies for approval (Phase 4)
Compose BOM + M3 · supabase-kt BOM (auth/postgrest/storage) · ktor-okhttp · kotlinx-serialization · Hilt (+ work) · Room · navigation-compose · WorkManager · DataStore · CameraX · Coil · DantSu ESCPOS 3.4.0 · JUnit / Turbine / MockK / Robolectric.
