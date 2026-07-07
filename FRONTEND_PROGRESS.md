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
- [ ] **Intake (Reception)** — customer → vehicle → damage markers / photos → "Start quotation".
- [ ] **Quote builder** — service/product lines, discounts, accept → job (technician + start).
- [ ] **Jobs board** — 4-column kanban (Scheduled/In progress/Ready/Done) + right detail sheet.
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

## Build order
App shell first (navigation foundation) → Intake → Quote → Jobs → Stock → Certificates → Dashboard.
