# Handoff: undo the two-company build and run the tyre centre as two shops

Written 2026-11-22 for the agent that implements this. Read all of it before you touch anything.
Repo rules live in `AGENTS.md`. Where this file disagrees with `AGENTS.md`, the user's decision
recorded here wins.

---

## 1. What happened and what the user decided

**The customer.** A new owner has one building and two companies that work together:

- **The tyre company** is VAT-registered and sells tyres.
- **The service company** is NOT VAT-registered. It does wheel balancing, alignment and similar work.

**What we built.** PRs #26 to #29 (merged to `main`, commits below) taught ONE shop to hold
several "issuing companies". That meant a `legal_entities` table, a number series per company,
one checkout that splits into one invoice per company, Z reports per company, a Companies
settings page and a "Sold by" column. The UI redesign that went with it lives only on branch
`tyrecentre-two-company`, never on `main`.

**The user's decision.** It was over-built. Undo it and use the simplest model, with no
frontend changes:

> **Each company becomes its own separate shop (tenant) on the system.**
> - Tyre shop: VAT 15%, its own VAT number.
> - Service shop: VAT 0%, no VAT number.
>
> Each has its own name, BRN, invoice numbers, stock, staff logins, till and Z report.

**New standing rule from the user:** no more business logic in PL/pgSQL. Write it in TypeScript
(server actions / `lib/`). Do NOT write new SQL functions, triggers or RPC bodies. The invariants
already in the database stay as they are: gapless numbering via `issue_document`, the fiscal
lock, rounding, and INSERT-only stock.

### What the owner accepts with this model (already explained to the user)

- **Logins.** `app_users.auth_user_id` is UNIQUE, so one login belongs to one shop. Staff who
  work for both companies need two logins, or each tablet is assigned to one company.
- **Customers.** The two shops do not share a customer list.
- **Checkout.** A car that gets tyres and an alignment gets two bills and two payments, one per
  company. Legally that is correct.
- **Reports.** Each company has its own reports and Z report.

---

## 2. The commits to undo

| PR  | Commit    | What it did |
|-----|-----------|-------------|
| #29 | `4fcb289` | Companies settings, "Sold by", the whole sale on each bill's page (phase E) |
| #28 | `5c8b620` | Receipts, A4 and reports per issuing company (phase D) |
| #27 | `b7066af` | DB two-company checkout: one invoice per company, one payment across them |
| #26 | `7e29b7b` | DB issuing companies: each with its own number series and VAT status |

`main` before these four is `d8358a8`. **None of the four touched `android/`**, so the tablet
app needs no rollback. The only tablet work is the ad-hoc VAT fix in step 5.

---

## 3. Facts checked against the live database (2026-11-22)

One Supabase project (`qecydemyqxdxwhkiyjtp`) holds three tenants:

| Tenant | Who | Companies (`legal_entities`) | Documents tied to a company |
|---|---|---|---|
| `…0001` | **The real shop** (Diamondbrite / Carfectionist), 15 users, 1,062 documents | 1 (default, VAT, `INV-`) | **0** |
| `…0002` | TEST Sandbox | 2: the sandbox, plus "TEST Wheel Services" (non-VAT, `TESTWS-`) | 3 (test bills) |
| `…0003` | HAZ demo | 1 (`DINV-`) | 4 |

- **No tyre-centre tenant exists yet.** Nothing real depends on the two-company feature.
- The four migrations **are applied in production.** The database stays as it is (see 4.1).

---

## 4. Hazards: read before reverting

### 4.1 Do NOT roll back the database. Keep the four migration files.

`20261122000010_legal_entities.sql`, `20261123000010_two_company_checkout.sql`,
`20261123000020_z_totals_per_company.sql` and `20261124000010_companies_admin.sql` are applied
in prod. They must stay in `supabase/migrations/` so the repo matches the database.

Rolling them back is dangerous:

- Invoice numbering now runs from `legal_entities.*_next_number`. The old
  `app.next_document_number` now RAISES. The `business_settings` counters are **frozen and stale**.
- Restoring the old numbering without first copying the counters back would duplicate or skip
  invoice numbers, which breaks the gapless invariant.
- It would also mean writing a lot of PL/pgSQL, which the user has banned.

For a one-company shop the new DB plumbing behaves exactly like before. Every tenant has one
default company, and a NULL company means the default one. Leave it dormant.

### 4.2 Database triggers the old web code will run into

These exist in prod (from `20261122000010_legal_entities.sql`):

- **`trg_business_settings_freeze_counters`** RAISES if anything UPDATEs `business_settings`
  `quote/invoice/credit_note` `_prefix`, `_next_number` or `_number_padding`.
  - **Check what the OLD Settings form (at `d8358a8`) writes.** If it sends numbering fields,
    unchanged values are fine. A changed value throws "number series live on the company".
  - Also check what the old Settings screen DISPLAYS as "next invoice number". It reads the stale
    `business_settings` counter.
  - **Fix in TypeScript, not SQL:** read and write numbering through the default `legal_entities`
    row. `authenticated` has no INSERT/UPDATE on `legal_entities`. Use the existing
    `public.save_legal_entity(p jsonb)` RPC from #29 (already in prod), or a server action with
    the service role. Do this in the server action / query layer so the visible UI stays the same.
- **`trg_business_settings_mirror_entity`** copies profile edits (name, BRN, address, logo, bank,
  receipt texts; plus VAT number and rate while the company is VAT-registered) from
  `business_settings` to the default company. So the old Settings profile form keeps working for
  receipts and invoices.
- **`trg_business_settings_default_entity`** gives every NEW tenant its default company
  (`vat_registered = true`), counters included. Creating the two new shops therefore works
  through the normal setup path.
- **`trg_lines_entity` (`app.lines_stamp_entity`)** forces `vat_rate = 0` on every line when the
  line's company has `vat_registered = false`. Step 4 uses this for the service shop.
- `issue_document`, `create_and_issue_credit_note`, `convert_quote_to_invoice`, `record_payment`,
  `cancel_job`, `app.z_totals` and `close_period` had their bodies spliced (signatures are meant
  to be unchanged). The splices are written to change nothing for one-company shops. **Verify
  this; don't assume it** (step 3).

### 4.3 Scripts and docs that must keep their `main` versions

These were changed in #26 to #29 to write `legal_entities` instead of the frozen
`business_settings` counters. Reverting them would make them throw:

- `scripts/_purge-test-docs.mjs`
- `scripts/_reset-import.mjs`
- `scripts/_verify-billed-quote-accepted.mjs`

**Keep `main`'s versions** of these. Also keep these, which are harmless and useful:

- `scripts/_dump-live-fns.mjs`
- `scripts/_tracker-diff.mjs`
- the `_verify-legal-entities` / `_verify-*` scripts (or drop the ones that test UI you removed)

`AGENTS.md` was edited in #26 to #29 (12 lines). Re-read the `main` version. Keep any lines that
are now true, such as numbering living on `legal_entities`. Fix the old rule "After any reseed,
set `business_settings.invoice_next_number`": the counter to set is now the default
`legal_entities` row.

### 4.4 Generated DB types

`apps/web/src/lib/supabase/database.types.ts` (if #26 to #29 regenerated it) describes the REAL
database, which still has the new columns. Prefer keeping `main`'s version. Revert it only if
`tsc` forces you to.

---

## 5. Steps

1. **Branch.** Work in a worktree off `origin/main`, e.g. `git worktree add .claude/worktrees/undo-two-company -b undo-two-company origin/main`.
   - The main checkout has the user's uncommitted files. Don't touch them.
   - A worktree needs its own `npm ci` inside `apps/web` (4 packages nest there; recharts breaks otherwise).
   - DB scripts in a worktree: `node --env-file=C:/Projects/Carfection/.env scripts/x.mjs`.
2. **Revert the code, keep the database files.**
   ```bash
   git revert --no-commit 4fcb289 5c8b620 b7066af 7e29b7b
   git checkout origin/main -- supabase/migrations/20261122000010_legal_entities.sql \
     supabase/migrations/20261123000010_two_company_checkout.sql \
     supabase/migrations/20261123000020_z_totals_per_company.sql \
     supabase/migrations/20261124000010_companies_admin.sql \
     scripts/_purge-test-docs.mjs scripts/_reset-import.mjs scripts/_verify-billed-quote-accepted.mjs
   ```
   Then handle `AGENTS.md` and the generated types as in 4.3 and 4.4. Commit as one revert commit
   that explains why.
3. **Prove the old web code runs on today's database.**
   - List every RPC the reverted web code calls: the typed wrappers in `apps/web/src/lib/supabase/rpc.ts`
     plus raw `.rpc("…")` calls. At `d8358a8` the raw ones include `cancel_job`,
     `deliver_paid_job`, `hand_back_paid_job` and `discard_draft`.
   - For each, compare the argument list the code sends with `pg_proc` in prod. Enumerate every
     overload per name, because a changed signature ADDS an overload instead of replacing it.
   - Pay most attention to the checkout path (issue + `record_payment` with `cashSessionId`),
     credit notes, the Z report and the month close.
   - Probe with BEGIN/ROLLBACK on the **sandbox tenant `…0002`**, impersonating its owner
     (auth uid `b729191b-1159-4d46-88c7-3c9aceb5e664`) via `request.jwt.claims`.
   - Never touch the real shop's number series. `scripts/verify-money-path.mjs` rolls back. Use it
     or copy its pattern.
4. **Make the service shop charge no VAT (data only, no new SQL logic).**
   - When the service tenant is created, set its default `legal_entities` row to
     `vat_registered = false, vat_rate = 0, vat_number = null`. Also set `business_settings.vat_rate = 0`.
   - The existing `trg_lines_entity` then forces VAT 0 on every line, even one the app sends at 15%.
5. **Fix ad-hoc lines that hard-code 15% VAT** (TypeScript + Kotlin, keep web and tablet in step).
   They should take the shop's VAT rate, so the totals on screen match what the database stores.
   - Web: `apps/web/src/features/documents/builder/DocumentBuilder.tsx` around line 460
     (`vatRatePct: 15` on a new ad-hoc line).
   - Web: the VAT toggle around line 937 (`l.vatRatePct > 0 ? 0 : 15`). Toggle to the shop's rate,
     and when the shop rate is 0 the toggle has nothing to do.
   - Web: `apps/web/src/features/documents/builder/state.ts` line 148 (blank line default `vatRatePct: 15`).
   - The builder context already loads the shop rate (`lib/supabase/queries/builder.ts:106`,
     `defaultVat`). Pass it through.
   - Tablet: `android/.../feature/quote/QuoteViewModel.kt` `addAdhoc(… vatRate = 15.0 …)` (~line 1300)
     and `addAdhocToBill(… vatRate = 15.0 …)` (~line 2420). Use `CatalogRepository.vatDefault()`
     (or what the screen already has) instead.
   - The `?? 15` fallbacks elsewhere are fine: they only apply when the value is NULL, and a 0%
     shop stores 0.
   - Add vitest tests for the web change.
6. **Create the two shops.** Do this only after the user gives the real details. **Ask the user
   for:** each company's legal name, trading name, BRN, the tyre company's VAT number, address,
   phone and email, invoice/quote/credit-note prefixes, logo, and the owner's two logins.
   - Use the HAZ demo setup script (`scripts/` setup-demo / setup-sandbox) as the template. Don't
     write new tenant-creation SQL functions.
   - Tablets are registered per tenant (`TAB-xxxx` codes), so decide with the user which tablet
     belongs to which shop.
7. **Verify, then open a PR.**
   - `npx tsc --noEmit` in `apps/web`, and `npm run test --workspace web`.
   - Lint only the files you touched. Lint is already red on a clean `main`, so compare against HEAD.
   - Tablet: `./gradlew assembleDebug` (not `gradlew.bat` under Git Bash). Install with
     `adb install -r` on the emulator, which is debug-signed.
   - Check in the browser preview (`scripts/_mint-session.mjs` mints an owner cookie) that
     Settings, a counter sale, a quote, an invoice PDF and the Z report still work.
   - Open a PR. **Pushing to `main` auto-deploys**, and CI's smoke test runs signed out, so it
     cannot catch a broken signed-in query. Probe prod before merging, and don't merge without the
     user's OK.

---

## 6. Leave alone

- Branch `tyrecentre-two-company`, the `db-*` / `two-company-web-e` branches and their worktrees.
  Don't delete them. The user decides.
- The sandbox's second company "TEST Wheel Services" and its 3 `TESTWS-` bills. These are harmless
  test data. Its existence also shows the dormant multi-company path still issues correctly.
- Every database invariant in `AGENTS.md`.
