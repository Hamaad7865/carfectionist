# Prompt: Tyre Centre redesign (web + Android tablet)

> Paste everything below the line into GitHub Copilot (agent mode, Claude Opus 5.5).
> **Attach the four PNGs** in `docs/redesign/screens/` to the chat, so Copilot can see the design.
> Run this **after** `docs/prompts/two-company-billing.md` is merged: the screens depend on its
> issuing companies (`legal_entities`) and on one checkout producing one invoice per company.

---

You are working in the **Carfectionist / HAZ Software** monorepo: a POS + back office for Mauritius.
- `apps/web/`: Next.js 16 App Router, Tailwind v4, deployed to Cloudflare Workers via OpenNext.
- `android/`: Kotlin / Jetpack Compose tablet till.
- One Supabase backend for both.

Your job is to build a **new visual design** for a new client: a tyre centre that bills through two
companies, one VAT-registered and one not. It covers the web back office and the Android tablet
till. **No business logic changes.** This is a presentation layer on top of the existing features,
server actions, RPCs and ViewModels.

## Read these first, in full

1. `AGENTS.md`: repo rules, build/deploy gotchas, database invariants. All of it applies.
2. `docs/redesign/DESIGN-SPEC.md`: **the design you are building**: tokens, type, components,
   per-screen specs, Android mapping.
3. The four mockups in `docs/redesign/screens/` (attached to this chat). The live design file is
   https://kite.new/p/smyhnsxk7rp2fue4 (use only the "Web — light (v2)" and "Android tablet" pages;
   the dark "Web" page was rejected).
4. `ANDROID_PARITY.md`: every tablet change has a web twin and vice versa.
5. The current shell and brand plumbing:
   - `apps/web/src/lib/brand.ts`, `brand-server.ts`;
   - `apps/web/src/app/layout.tsx`, `src/app/(app)/layout.tsx`;
   - `src/components/shell/{AppShell,Sidebar,Topbar}.tsx`;
   - `src/app/globals.css`;
   - `android/app/build.gradle.kts`, `android/app/src/main/java/mu/carfection/pos/ui/theme/Theme.kt`.
6. The screens you will restyle: `src/app/(app)/dashboard` (Overview),
   `src/app/(app)/point-of-sale` with `features/counter` and `features/pos` (New sale),
   `features/jobs`, `components/pdf/ReceiptCard.tsx`; on Android
   `feature/{counter,settlement,till}` and `core/print`.

## The single most important rule

**Carfectionist and the HAZ demo must look exactly as they do today.** The new design applies only
when the brand is `tyrecentre`:
- **Web:** the request host maps to the brand in `brandForHost`. Add a `TYRECENTRE` `BrandInfo` with
  placeholder hosts (e.g. `tyrecentre.localhost` for dev; the real domain comes later).
- **Android:** the `tyrecentre` product flavor.

Before and after each phase, screenshot the Carfectionist dashboard, counter and receipt on the web,
and the till on the tablet, and confirm nothing moved.

## What to build

### Web

1. **Set up the component libraries.**
   - Initialise **shadcn/ui** for Tailwind v4 in `apps/web` (`components.json`, `src/components/ui/`,
     `cn()` util, CSS variables).
   - Register **HextaUI** as a shadcn registry namespace `@hextaui`. Follow
     https://www.hextaui.com/llms-full.txt and https://hextaui.com/docs; install by
     `npx shadcn@latest add @hextaui/<component>`.
   - Install only what the spec's §5 table lists:
     - shadcn: `sidebar`, `dropdown-menu`, `avatar`, `command`, `tabs`, `table`, `select`,
       `button`, `sonner`, `tooltip`, `collapsible`;
     - HextaUI where it has them: `card`, `badge`, `kbd`, `toggle-group`/`chip`.
   - **Do not** let shadcn's base styles or CSS variables change any existing Carfectionist page.
     Scope every new variable under `[data-brand="tyrecentre"]`, and check the existing pages.
2. **Brand theming.**
   - The root layout sets `data-brand` on `<html>` from `getBrand()`.
   - In `globals.css`, a `[data-brand="tyrecentre"]` block maps both the shadcn/HextaUI variables
     and the existing `--color-*` tokens to the spec's §2 values. That way pages not yet redesigned
     still look coherent under the new brand.
   - Company colours come from the issuing company's `sort_order` (spec §2), through one helper
     (e.g. `src/lib/entity-colors.ts`). Never hard-code a company name.
3. **New shell.** For `tyrecentre`, `AppShell` renders a `ShadcnShell`:
   - `SidebarProvider` plus the sidebar in spec §6.1, reusing the role/module filtering from the
     current `Sidebar.tsx` (extract it into a shared function, don't duplicate it);
   - ⌘K `command` search wired to the existing `GlobalSearch` behaviour;
   - cmd/ctrl+B collapse;
   - collapsed by default on the New sale route.
   - The current Carfectionist shell stays untouched.
4. **Overview page** (spec §6.2): the hero card with the custom SVG dot chart, the "In the bays"
   table and "Needs you". Use **only data the system already has**: the sales journal / Z totals
   per company, jobs and their statuses, stock levels, discount-override requests, the till state.
   If a widget has no real data source, **leave it out and list it** in your plan. Don't invent
   tables or fake numbers.
5. **New sale page** (spec §6.3). Restyle the existing counter flow:
   - the tyre size finder (filter on existing product attributes; if size isn't a structured field
     yet, propose the smallest additive migration in the plan and wait);
   - filter chips, the product grid, the car history ("Add again" re-adds the lines);
   - the cart split into one bill per company, from what `issue_checkout` will produce;
   - one Charge button.
   Never show an invoice number before the charge succeeds.
6. **Receipts.** `ReceiptCard` gets the two variants in spec §6.5: VAT company and non-VAT company.
   Legal fields are never hidden on a VAT invoice. The non-VAT slip has no VAT lines or VAT number.

### Android tablet

7. **Flavors.**
   - Add flavor dimension `brand` with flavors `carfectionist` (**keep `applicationId`
     `mu.carfection.pos`**, so existing tablets keep updating) and `tyrecentre` (own
     `applicationId`, placeholder `mu.haz.tyrecentre.pos`, own app name/icon).
   - Update every build/publish script and CI step that calls `assembleDebug` / `assembleRelease`
     to the flavored task (`scripts/`, `.github/workflows/`). Search for them all.
   - Never commit `android/keystore/` or signing secrets.
8. **Tokens.** Turn the top-level colour `val`s in `ui/theme/Theme.kt` into a `BrandTokens` data
   class, provided via `CompositionLocal`.
   - Carfectionist's values stay **identical**.
   - `tyrecentre` supplies the spec §2 tokens and bundles Manrope, Archivo and JetBrains Mono (OFL)
     in its flavor `res/font`.
9. **Screens.** Till (spec §6.4) and Paid (spec §6.5).
   - Light nav rail, 150dp tiles, the dashed "Custom line · Pick the company" tile, the cart with
     one bill per company, a 64dp Charge pill.
   - The Paid screen shows the change due, the issued invoice numbers and the receipt previews
     drawn **by the same code that prints** (`ReceiptText`/`ReceiptPaper`).
   - Keep the ViewModels, repositories and offline sales queue shared and unchanged. Only the
     composables differ.
10. **Parity.** Every visual change to the cart, bill blocks or receipts lands on web and tablet in
    the same commit, with a shared fixture test (receipt parity rule).

## Hard rules

- **No logic in the UI.** Money comes only from `src/lib/money/` (web) and `core/money` (Android).
  Totals and VAT come from the database. All writes go through the existing typed RPC wrappers in
  `src/lib/supabase/rpc.ts` and the existing zod server actions.
- Build with webpack (`next build --webpack`). Don't add middleware/`proxy.ts`. `wrangler.jsonc`
  stays as it is.
- Work on a feature branch. **Never push to `main`**: it auto-deploys to production.
- The live database is production data. Do UI checks against the TEST Sandbox tenant
  (`…0000-000000000002`).
- Accessibility: every icon-only button has an `aria-label`; the dot chart has a table fallback;
  text contrast ≥ 4.5:1 (muted text on white is fine; check lime text and faint labels).
- Don't install other UI kits. Don't copy components from any site other than shadcn and HextaUI.

## Verification (required before "done")

1. `npm run test --workspace web` passes, plus new tests:
   - brand detection for the new host;
   - entity colour helper;
   - `ReceiptCard` VAT and non-VAT variants;
   - a snapshot proving the Carfectionist `ReceiptCard` and shell are unchanged.
2. `cd apps/web && npx tsc --noEmit` is clean. Lint only the files you touched (lint on `main` is
   already red); compare against HEAD.
3. `npm run cf-build --workspace web` succeeds.
4. Screenshots, from `next dev` with the tyrecentre host, of Overview and New sale at 1440×920,
   placed next to the mockups. Plus Carfectionist before/after screenshots showing no change.
5. Android:
   - `./gradlew assembleCarfectionistDebug assembleTyrecentreDebug` both succeed;
   - the Carfectionist debug build installs **over** the existing one on the emulator (same app
     id) and looks unchanged;
   - the tyrecentre build's Till and Paid screens are screenshotted at 1280×800.

## How to work

Phase-gated:
1. **First**, write a plan to `docs/superpowers/plans/tyrecentre-redesign.md`:
   - the component install list;
   - token mapping;
   - how the brand switch reaches each layer;
   - every file you'll touch;
   - widgets without a data source;
   - any migration you think is needed.

   **Stop and wait for my approval.**
2. Then implement and verify each phase before starting the next:
   1. libraries + brand theming;
   2. shell + sidebar;
   3. Overview;
   4. New sale + receipts;
   5. Android flavors + tokens;
   6. Android Till + Paid;
   7. full verification.

Commit per phase. Report in plain language what changed, what was proven (with screenshots), and
anything left out.
