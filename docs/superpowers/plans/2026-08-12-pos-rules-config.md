# POS rules — owner-editable configuration, read live by the tablet

## Goal
Move the POS behaviour rules out of hardcoded constants and into `business_settings`,
give the owner one place to edit them (a new **POS rules** settings section on web),
and have the tablet read them live through the same sync path the points switch uses.

Every new column defaults to **today's hardcoded value**, so nothing changes for any
shop until the owner touches it.

## What becomes owner-editable
| Group | Column (business_settings) | Default = current behaviour |
|---|---|---|
| Discounts | `discount_carwash_pct numeric` | 5 (was `0.95` literal in the SQL, `CARWASH_MAX_PCT=5` in TS/Kotlin) |
| | `default_policy_service text` | `none` |
| | `default_policy_goods text` | `free` |
| | `allow_discount_override boolean` | true (owner PIN may raise the ceiling) |
| Points | `points_enabled`, `points_per_100`, `point_value_rupees` | already exist — surfaced here |
| POS defaults | `default_opening_float numeric` | 0 (client reconciles its prefill) |
| | `allow_negative_stock boolean` | true (client currently prompts, then allows) |
| | `vat_rate` | already exists — surfaced here |
| Reversal | `reversal_requires_owner boolean` | false (owner-or-override, as shipped) |

Per-item policy stays on each product/service in Products (override wins over the
per-kind default). The two per-kind defaults are what an `inherit` item falls back to.

## The one hard part
The carwash cap is one value read in THREE engines — `app.document_discount_limits`
(SQL), `allowance.ts`, `Allowance.kt` — held to identical fixtures so they never
disagree. Source moves from a constant to the setting; arithmetic is unchanged.

## Phases (each verified before the next)
1. **DB** — add the columns (safe defaults); parameterise `document_discount_limits`
   to read the cap + per-kind defaults; gate `require_owner_or_override` on the toggle.
   Rolled-back probe: cap=5 reproduces today's numbers exactly; cap=10 moves them; the
   strict toggle refuses a manager-with-override. `assert_discount_allowed` and
   `issue_document` already call the parameterised function, so they inherit it.
2. **Web** — POS rules section (read/write); thread the cap + defaults into `allowance.ts`.
3. **Tablet** — extend `fetchSettings` + `CatalogRepository` flows; thread the cap +
   defaults into `Allowance.kt` and the counter; parity tests mirroring web.
4. **Prove** — rolled-back DB probes, a live web + emulator check, the android↔web
   parity gate, and an adversarial bug review of every new block.

## Non-negotiables
- Migrations via `scripts/db-exec.mjs` (never `db:push`).
- Function splicing/replace from the live body, never retyped from memory.
- Android↔web parity enforced in the shared value first, then both UIs.
- Defaults preserve current behaviour — no silent change on deploy.

## Open decisions (proceeding on the recommended default; flag if wrong)
- Points folded INTO the POS rules section (one home). 
- Reason gate stays structural ("past goods → reason"), not a number.
