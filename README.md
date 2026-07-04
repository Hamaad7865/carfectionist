# Carfectionist system

Business management system for a premium car detailing studio in Mauritius
(**Carfectionist**, under Haz Software). Two surfaces on one shared Supabase backend:

- **`apps/web`** — Next.js (App Router) back office: documents, customers, inventory,
  purchasing, accounting, reports. Deployed on Cloudflare Workers via OpenNext.
- **`android`** — Kotlin/Jetpack Compose tablet POS (Phase 4): intake, quotes, jobs,
  checkout, thermal receipt printing. Online-primary with an offline fallback.
- **`supabase`** — Postgres schema (migrations), row-level security, RPCs, seed data.

## Business constants
Currency **MUR**, displayed `Rs 32,000.00`. VAT **15%**, prices **VAT-exclusive**.
Locale: Mauritius.

## Repo layout
```
apps/web/     Next.js back office
android/      Kotlin POS (Phase 4)
supabase/     migrations/, functions/, seed.sql
scripts/      seed-users.mjs and other one-off scripts
docs/         schema doc, master prompt, VAT test vectors, phase test scripts
```

## Getting started
See `docs/` for the schema and build plan. Environment setup: copy `.env.example`
→ `.env` and `apps/web/.env.local.example` → `apps/web/.env.local`, then fill in the
values from your hosted Supabase project.

## Build order
Built strictly phase-by-phase (0 → 5); each phase ends with a manual test script and
a stop for sign-off before the next begins. Phase 0 = foundation (schema, seed, auth,
app shell).
