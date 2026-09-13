# Carfectionist — agent instructions

Premium car-detailing business system (Mauritius). Two clients, one hosted Supabase backend.

- `apps/web/` — Next.js 16 (App Router) back office. Deployed to Cloudflare Workers via OpenNext.
- `android/` — Kotlin/Jetpack Compose tablet POS (separate Gradle project; see `ANDROID_PARITY.md`).
- `supabase/migrations/` — Postgres schema + RPCs. `docs/detailing-studio-schema.md` is the authoritative schema doc.
- `scripts/` — DB ops + verification scripts (run from repo root, read root `.env`).

## Commands

```bash
npm run db:setup                  # full DB setup: push + seed users + seed + types (root .env required)
npm run db:push                   # push supabase/migrations to hosted DB (--db-url, no supabase login needed)
npm run test --workspace web      # vitest run (all web tests)
npm run lint --workspace web      # eslint
npm run deploy --workspace web    # OpenNext build + wrangler deploy (needs Cloudflare login)
```

From `apps/web/`: `npx vitest run src/<path>/<name>.test.ts(x)` for a single test file;
`npx tsc --noEmit` for typecheck (no script defined); `npm run preview` for local workerd test
(needs `apps/web/.dev.vars`, gitignored).

## Build / deploy gotchas (do not guess these)

- **Always build with webpack**: `next build --webpack`. Turbopack's bracketed chunk names
  (`[root-of-the-server]__<hash>._.js`) cannot resolve inside the Worker → intermittent per-isolate
  `ChunkLoadError` 500s on a green build. `cf-build` already does
  `next build --webpack && opennextjs-cloudflare build --skipNextBuild` (`--skipNextBuild` is load-bearing;
  without it OpenNext re-runs the build with Turbopack). `next.config.ts` must keep `output: "standalone"`.
- **No `proxy.ts`/middleware**: Next 16 proxy is Node-only and OpenNext blocks it. Route protection is
  server-side (`(app)` layout `requireSession` + Postgres RLS); token refresh is the client
  `AuthKeepalive`. Do not re-add middleware.
- `wrangler.jsonc` needs `nodejs_compat_populate_process_env` (compat date predates 2025-04-01) —
  without it every `process.env.*` read is `undefined` in production while working in `next dev`.
- Push to `main` auto-deploys (`.github/workflows/deploy.yml`: test → webpack build → OpenNext bundle →
  deploy → multi-page × 3-round smoke test). Deploys queue; never cancel in-flight.
- PDF rendering uses the `browser` binding (Browser Rendering) — no secret needed; route returns
  graceful 503 locally without it. Email receipts use the `EMAIL` binding (needs one-time dashboard enable).

## Environment

- Root `.env` (gitignored, see `.env.example`): `SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL`
  (use the **Session pooler** URI on IPv4), `SUPABASE_SERVICE_ROLE_KEY` (seed/server scripts only —
  never ships to browser or Android), optional `SUPABASE_ACCESS_TOKEN` (only for `db:types`).
- `apps/web/.env.local` (gitignored, see `.env.local.example`): `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, server-only `SUPABASE_SERVICE_ROLE_KEY`.
- Never commit `.env`, `.dev.vars`, or `android/keystore/` (losing the keystore bricks app updates).

## Database invariants (hold in every change, no exceptions)

- **Event-sourced stock**: INSERT-only into `stock_movements`. Never UPDATE/DELETE stock rows.
- **Gapless numbering ONLY via the `issue_document` seam** (quotes `A…`, invoices `INV-…`, credit notes `CN-…`).
  Never mint numbers client-side. After any reseed, set `business_settings.invoice_next_number` to max+1.
- **Invoice fiscal lock**: issued invoices are immutable; legal fields are never hidden by template config.
- **RLS on every query**; all writes are zod-validated server actions (`features/<domain>/actions.ts`).
- **Rounding authority is the database** (generated columns, line-level `round(x,2)` half-away, then summed).
  Money is `numeric(12,2)` — except costs (`numeric(12,4)`) and quantities (`numeric(12,3)`).
- Money crosses the RPC boundary in **rupees**; the client keeps **integer cents** above it.
  All money-path writes go through typed wrappers in `apps/web/src/lib/supabase/rpc.ts` — never call
  RPCs by raw name or reimplement totals. `document_lines.product_id` is nullable by design (ad-hoc lines).
- Migrations are additive and numbered (`supabase/migrations/`); push with `npm run db:push`, never hand-edit prod.
- **Live DB is production data** (go-live replaced seed rows). `scripts/verify-money-path.mjs` rolls back
  to preserve the number series; other `scripts/_verify-*.mjs` scripts may leave harmless test rows —
  note them in `PROGRESS.md` as prior entries do. Never weaken a failing test to make verification pass.

## Business constants

Currency **MUR** (`Rs 32,000.00`), VAT **15%**, prices **VAT-exclusive**, locale Mauritius.
Use `src/lib/money/` (format/totals/parse/number-to-words), `phone.ts`, `mu-date.ts` — don't hand-roll.

## Layout (`apps/web/src/`)

`app/` routes (route groups `(app)` authed / `(public)` / `api/` / `print/doc/[id]` print route) ·
`features/<domain>/` (UI + `actions.ts`) · `lib/supabase/rpc.ts` (numbering seam) ·
`lib/pdf/`, `components/pdf/` (DocumentA4) · path alias `@/*` → `src/*` ·
tests colocated `src/**/*.test.{ts,tsx}`. Per-report CSV: `/api/reports/[slug]/csv`.

Note: `apps/web/AGENTS.md` holds a generic Next.js-version warning; this file is the repo source of truth.
