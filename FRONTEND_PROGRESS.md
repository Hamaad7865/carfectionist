# Frontend progress — Android POS, pixel-match to the handoff

**Ground truth**
- `design-reference/Detailing-POS.html` — the Claude Design prototype (authoritative for all styling).
- `design-reference/TOKENS.md` — extracted tokens, mirrored 1:1 in `ui/theme/Theme.kt`.
- The handoff shipped **no per-screen PNGs**; its README says the code is the ground truth.
  So each screen's reference is **rendered on demand** during its iteration (serve the HTML,
  navigate to that screen, screenshot) and compared against the emulator render.

**Target:** the Android POS (Kotlin / Jetpack Compose), landscape tablet (2560×1600 = 1280×800dp).
Tokens live in `ui/theme/Theme.kt` (exact handoff values). Shared components built once, reused.

## One-time setup
- [x] `/design-reference/` populated from the handoff.
- [x] Tokens extracted → `design-reference/TOKENS.md` + `ui/theme/Theme.kt`.
- [x] This tracker created.

## Screens
- [x] **Login** — light/teal/Barlow. Verified on tablet. *(deviation: real auth — see below)*
- [x] **Sale / Checkout** — method pad, quick-tender, numpad, live change. Verified on tablet.
- [x] **Till** open/close — light/teal. *(supports checkout; not a distinct handoff screen)*
- [x] **App shell** — header (58px: logo tile, name, live clock, Online pill, staff chip) + left
  nav rail (86px, 7 buttons with the handoff's exact stroke icons + active teal state). Verified on
  tablet; nav switching + screen-title pattern match the handoff. *(deviations logged below)*
- [x] **Intake (Reception)** — customer search/create, vehicle select/create, CONDITION & DAMAGE
  card with the handoff's exact top-view car diagram (vector) + tap-to-place damage markers + type
  chips + photos, and the "Start quotation" footer. Real customers/vehicles via the repos + create_job.
  Verified on tablet (customer picked, 2 markers placed). *(deviations logged below)*
- [x] **Quote builder** — list mode (quote cards: ref/status chip/customer/vehicle/total/date) + builder
  mode (back header, category tabs, 2-col product tiles with teal count badges, dashed ad-hoc tile → typed
  line dialog, QUOTE LINES with expandable rows [qty stepper + 0/5/10/15/20% discount chips + red remove],
  gross Subtotal + green Line discounts + line-level VAT 15% + teal TOTAL, Save draft / Accept → create job
  → ASSIGN TECHNICIAN chips + START time chips → Create job). Real quotes/lines/products/technicians via
  the repos + save_draft/create_job RPCs. Verified on tablet end-to-end: list, hydrate, add product (badge),
  expand, 10% discount (−Rs 120 green row, VAT/total recompute), ad-hoc line (4th line Rs 1,500, total
  Rs 13,202), accept panel (Deven/Yash/Kevin chips + times), vehicle-less guard. *(deviations below)*
- [x] **Jobs board** — 4-column kanban (Scheduled/In progress/Ready/Delivered) with dot colours + count
  badges + job cards (plate badge, status-coloured right text, vehicle, service note, technician avatar),
  and a 560dp right **detail sheet** (scrim; ref + status chip + close; customer/phone/plate/vehicle; ⚠
  damage-marker note; TECHNICIAN chips; live TIME ON JOB timer; CHECKLIST with progress bar + tap-toggle;
  BEFORE/AFTER photo grids; contextual footer action). Real jobs via `fetchJobs` (customer/vehicle/tech
  embeds). Verified on tablet end-to-end: board renders all 4 statuses, detail opens, checklist toggle
  (2/5→3/5, persists), technician chips, live timer (55m→1h+), and **Mark ready** (complete_job RPC:
  in_progress→ready, card moved columns). *(deviations below)*
- [ ] **Stock** — on-hand grid, ±1 quick adjust, "Adjust…" modal.
- [ ] **Certificates & warranty** — ceramic certificate viewer + maintenance schedule.
- [ ] **Today / Dashboard** — KPIs, 7-day turnover bars, best sellers, technicians, payment mix.

## Deviations (permitted only when forced by real functionality — each justified)
- **Login screen exists** though the handoff starts post-auth (staff PIN switch). Justified:
  the app needs real Supabase authentication before any tenant data can load.
- **Staff chip taps to sign out** (handoff opens a multi-staff PIN switch). Justified: real auth —
  M1 has one signed-in user, no PIN roster; sign-out is the functional equivalent.
- **Staff avatar uses the accent colour** (handoff assigns a per-staff colour). Justified: single
  seeded owner; no per-staff colour data yet.
- **6 unbuilt tabs show a "Coming soon" placeholder** (with the handoff's real title row). Not final —
  each becomes its own screen iteration; the placeholder is temporary scaffolding.
- **Intake: photos "＋ ADD" is a stub** (no real camera/upload). Justified: CameraX + storage wiring
  is a later milestone; the button + empty grid match the handoff's empty state.
- **Intake: no "visits" badge** on the selected customer (handoff shows a visit count). Justified: no
  visit-count aggregate is queried yet.
- **Intake: "Start quotation" creates a job** (create_job RPC → "Job started" dialog) rather than opening
  the Quote builder. Justified: the Quote screen isn't built yet (next iteration); the job is the real
  backing record a quote attaches to.
- **Quote: category tabs are product KINDS** ("All" + kinds present), not the handoff's service categories.
  Justified: the seeded catalogue is all `kind=product` (no service rows yet); service tabs appear once
  service products exist. Data-driven, not hardcoded.
- **Quote: product tile omits the handoff's "Stock N" meta line.** Justified: on-hand quantity isn't in the
  POS catalogue cache (`ProductEntity`); a per-tile stock read is a later inventory-sync milestone.
- **Quote: ad-hoc entry uses a name+price dialog**, not the handoff's dedicated on-screen numpad modal.
  Justified: functionally equivalent (same result — a `product_id=null` line); the dashed tile + fields
  match the handoff. Price parses via the shared `parseMoneyToCents`.
- **Quote: technician avatars use the accent colour** (handoff assigns a per-staff colour). Same root cause
  as the app-shell staff-avatar deviation — no per-staff colour data.
- **Quote: "Accept → create job" creates the job (create_job) but does NOT mark the quote `accepted` or link
  the job to the quote document.** Justified: the backend has no `convert_quote_to_job` RPC (only
  `convert_quote_to_invoice`); linking + status flip needs a new migration (spawned as a follow-up task).
  Guarded against double-submit (busy-disabled buttons). Vehicle-less standalone quotes surface
  "This quote has no vehicle" rather than converting (create_job requires a vehicle).
- **Quote: START time is captured but not persisted** — `create_job` has no `scheduled_at` param.
- **Data fix (not a code deviation):** the 3 seed technicians (Deven/Yash/Kevin) were `is_active=false`, so
  the ASSIGN TECHNICIAN row was empty; activated them so job assignment works. Empty-state hint added too.
- **Jobs: card "service" line = `jobs.notes`** (jobs carry no line items; service detail lives on a linked
  document, and there is no `job.document_id` column). The handoff shows the first service name + "N more".
- **Jobs: Ready-column card right shows the ready time (HH:mm), not the invoice total** — jobs carry no
  monetary total and there is no queryable job→invoice link. Delivered shows "Done" (jobs don't track a
  paid flag; the handoff's "✓ Paid" also relied on a mono ✓ glyph that renders poorly on Android).
- **Jobs: BEFORE/AFTER photos are stubs** (None / ＋ADD → toast). Same milestone as intake photos (CameraX
  + `job_photos` storage).
- **Jobs: TIME ON JOB is display-only** — elapsed from `started_at` (frozen at `ready_at` for ready jobs);
  no pause/resume, the `job_timers` table isn't wired (later milestone). "Start" (scheduled→in_progress,
  stamps `started_at`) is real.
- **Jobs: "Go to checkout" / "View invoice" both switch to the Checkout tab** — jobs have no invoice link
  to open a specific bill.
- **Jobs: status writes use the generic `jobs` UPDATE RLS policy** — Start job / technician reassign /
  checklist toggle are direct column updates; Mark ready = `complete_job` RPC (also records stock
  consumption). No dedicated per-transition RPCs exist. Optimistic UI with reload-on-failure.
- **Data (verification):** seeded 3 jobs (in_progress / ready / delivered) with vehicles, technicians,
  checklists + damage markers, and enriched the pre-existing scheduled job, to populate all four columns.

## Build order
App shell first (navigation foundation) → Intake → Quote → Jobs → Stock → Certificates → Dashboard.
