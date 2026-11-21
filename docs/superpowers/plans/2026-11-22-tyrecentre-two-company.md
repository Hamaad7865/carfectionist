# Tyre Centre: two companies, two receipts, tablet app, new dashboard

Branch `tyrecentre-two-company`, built on Copilot's `sheikb-dev-tyrecentre-redesign` (web look + my
split-payment fix). Nothing goes to `main` or the live database without your yes at each gate below.

## What you get at the end

1. **One sale, one payment, two invoices.** Tyres go on the tyre company's invoice (with 15% VAT);
   alignment, balancing and fitting go on the service company's invoice (no VAT, no VAT number).
   Each company has its own number series (e.g. `TC-0001…` and `WS-0001…`), gapless.
2. **Two receipts** printed back to back, web and tablet identical. The VAT one keeps every legal
   field; the non-VAT one has no VAT lines and no VAT number.
3. **Reports per company**: Z report, sales journal, VAT report, period close and CSVs show each
   company's totals, plus the combined drawer (one physical cash drawer).
4. **Companies settings page** (owner only) and a "Sold by" picker on each product.
5. **Tablet app for the tyre centre**: a second build of the same app with its own name, icon and
   look. The Carfectionist app keeps its ID, so the shop's tablets keep updating normally.
6. **A new dashboard** (see section F).
7. **Carfectionist sees no change anywhere.** It gets one company (itself), and one company
   behaves exactly like today. This is checked with before/after screenshots and tests.

## How it works (the short version)

- A new **companies** table (`legal_entities`) inside the tenant. Each existing tenant gets one
  company copied from its current settings, **including its current invoice counters**, so
  Carfectionist's next invoice number is exactly the one it would have been.
- Today every number comes from one internal function, `app.next_document_number(tenant, type)`.
  It cannot know the company, so a new `app.next_entity_number(company, type)` replaces it and
  every caller is repointed (including the functions patched in place). The old function then
  **raises an error** instead of quietly using the default company, so a missed caller fails loudly
  rather than putting a service invoice in the tyre series. A check on `pg_proc` proves no function
  still calls the old one.
- Every product can say which company sells it (blank = the default company). Every document
  belongs to one company. The database refuses a tyre line on the service invoice, and forces VAT
  to 0 on any line of a non-VAT company — not just the screen.
- A new `issue_checkout` call takes the mixed cart, splits it by company, issues one invoice per
  company through the normal `issue_document` path, and links them with a `checkout_group_id`.
  Replaying the same sale key returns the same invoices and uses no new numbers (needed for the
  tablet's offline queue).
- A new group payment call takes the customer's payment once (including split cash + card) and
  spreads it across the sibling invoices in one transaction, through the same till check as today.

## Phases and gates

Each phase ends with its tests green and a short report to you. **Gates** need your yes.

### A. Safety baseline (no changes)
- Copy the **live** definitions of every function I will touch from the database (several were
  patched in place, so the files are not the truth): `issue_document`, `save_draft`,
  `record_payment`, `reverse_payment`, `create_document_from_job`, `convert_quote_to_invoice`,
  `convert_quote_to_job`, `accept_quote`, `create_and_issue_credit_note`, `cancel_job`,
  `app.next_document_number`, `app.z_totals`, `close_service`, `close_day`, `close_period`,
  `import_products`.
- Compare the migration tracker with the files (a push runs every file it hasn't recorded).
- "Before" screenshots of Carfectionist: dashboard, counter, a receipt, an A4 invoice, Z report.

### B. Database: companies and numbering — **gate: you approve before it is pushed live**
New numbered migrations, all additive:
- `legal_entities`: names, BRN, VAT registered yes/no, VAT number, VAT rate (must be 0 when not
  registered), address, phone, email, bank, receipt logo, footer, prefixes/counters/padding for
  quotes, invoices and credit notes, default flag (exactly one per tenant), order, active. RLS like
  every table; counters writable only by the numbering function.
- Backfill one default company per tenant from `business_settings`, counters included. The
  migration first **locks `business_settings`**, so no till can issue a number between copying the
  counters and the cut-over, and it is pushed **outside trading hours**.
- `products.legal_entity_id` (blank = default). `documents.legal_entity_id` and
  `documents.checkout_group_id`. **Old documents are not touched**: issued invoices are locked, so
  the column stays blank on history and "blank" means "the tenant's default company" wherever it
  is read. New documents get it when the draft is created; the group id is stamped on the drafts
  before they are issued, never after.
- Numbering cut-over to `app.next_entity_number` (above). The old business-settings counters stop
  being used; before freezing them I check `scripts/` (db:setup, reseed, `verify-money-path.mjs`)
  for writers and repoint them, and the settings page shows the counters from the company row.
  `AGENTS.md` reseed note updated.
- Line rules: on a non-VAT company VAT is forced to 0 on every line, always. "Every line belongs
  to the invoice's company" is checked **when the invoice is issued**, not while a draft is being
  edited, so draft bills stay editable as today. Quotes and jobs may mix companies; a mixed job is
  billed as one draft bill per company.
- Issued snapshot (`issued_legal_name/brn/vat_number`) taken from the company. Address, phone,
  logo and footer are read from the company row (they were never snapshotted).
- Replace every hard-coded 15% fallback in SQL with the company's rate.
- Every new or recreated function: one version only (checked in `pg_proc`), `anon`/`public`
  revoked by name and checked.
- Proof, inside a rolled-back transaction on the TEST Sandbox: the next Carfectionist and sandbox
  numbers are unchanged; a second sandbox company gets its own series.

### C. Checkout, payments, jobs, quotes, credit notes — **gate: before push**
- `issue_checkout` (above). A one-company cart gives exactly today's single invoice.
- Group payment + group reversal. Partial payment leaves each invoice correctly part-paid.
- Billing a job or converting a quote with both kinds of lines → one invoice per company, linked.
- A credit note uses the company and credit-note series of the invoice it credits.
- `scripts/_verify-two-company-checkout.mjs` (rolled back): 2 invoices, same group, own series,
  service invoice 0 VAT, tyre invoice 15% computed by the DB, one payment settles both, Z balances
  per company and in total, replay uses no numbers, credit note in the tyre series, one-company
  tenant still issues one invoice with its next number.

### D. Receipts, A4 invoices and reports (web)
- Receipt and A4 read the issuing company: legal name, BRN and VAT number from the issue-time
  snapshot, address/phone/logo/footer from the company row — not the live business settings.
  VAT and non-VAT variants; legal fields never hidden on a VAT invoice.
- Sending by email/WhatsApp sends every invoice of the checkout.
- Z report, sales journal, VAT report, period close, CSVs: per company + combined.
- Tests: receipt fixtures for both company types; a one-company tenant renders byte-identical.

### E. Web screens
- Settings → **Companies** (owner): list, add, edit; numbering and VAT status lock once the company
  has issued anything.
- Product form, import and export: **Sold by** column.
- Tyre Centre New sale: one bill block per company with its own subtotal/VAT, one grand total, one
  Charge; the Paid panel shows both invoice numbers and both receipts. No invoice number shows
  before the charge succeeds.
- Carfectionist counter: unchanged (one company → one bill, no new UI).

### F. The new dashboard (tyre centre only)
Replaces Copilot's version. Balanced: one glance answers "how are we doing today, what needs me".
I'll draw it in the design file first for your OK, then build it. Proposed layout:
1. **Today strip**: sales today per company (tyres incl. VAT / services), money collected, cars
   in the bays, open bills — animated numbers (HextaUI Number flow) on stat cards (Easy UI).
2. **Sales over time**: one chart, a toggle for 7 / 30 / 90 days, the two companies stacked in
   their colours (HextaUI Chart on Recharts, already in the app).
3. **In the bays**: today's jobs with car, work, status and technician (HextaUI Data table).
4. **Needs you**: unpaid invoices, low-stock tyres, discount approvals waiting, till not closed —
   each a short row with one action (HextaUI Item / Easy UI Activity feed). Empty state when clear.
5. **Top sellers this month**: tyre sizes and services (small bar list).
Only figures the system really has. Light by default, dark mode kept. Loading skeletons.
Components from shadcn, HextaUI (`npx shadcn@latest add https://hextaui.com/r/<name>.json`) and
Easy UI (`npx shadcn@latest add Surajmaurya1/easyui/<name>`). 21st.dev's connector needs a new key
from https://21st.dev/mcp before I can pull from it; until then I use the other three.

### G. Tablet app (Android)
- Build flavors: `carfectionist` (keeps `mu.carfection.pos`) and `tyrecentre` (placeholder
  `mu.haz.tyrecentre.pos`, own name/icon). Colours and fonts become a `BrandTokens` set chosen by
  the flavor; Carfectionist's values stay identical. Fonts bundled: Manrope, Archivo, JetBrains Mono.
- `publish-apk.mjs`: per-flavor APK path, file name and update manifest, so the two apps never
  overwrite each other's updates.
- Sale path: the tablet calls `issue_checkout` + group payment; the offline queue stores one sale
  and replays it under its original key (database upgrade for the queue table); `SaleResult` holds
  every invoice of the sale; receipts print one slip per company, identical to the web.
- **This changes Carfectionist's live till too** once the new app installs. A sale captured offline
  on the old app, or cut off mid-charge, must replay after the update without being issued twice:
  for a one-company cart `issue_checkout` reuses the same draft id (`draftIdFor(saleKey)`) and the
  same keys (`$saleKey:issue`, `$saleKey:pay`) as today. The same holds for a web retry across a
  deploy. Both are in the verification script.
- Tyre Centre Till and Paid screens from the mockups.
- Verified on the emulator with debug builds: Carfectionist installs over the current one and looks
  unchanged; tyre centre Till and Paid screenshotted at 1280×800.

### H. Final checks
`npm run test --workspace web`, typecheck, lint on touched files, `cf-build`, both Android
debug builds, before/after screenshots next to the mockups, `PROGRESS.md` entry listing any
sandbox test rows. Then I ask you before any merge to `main` (which deploys).

## Questions for you (I've put my suggestion first)

1. **A discount on the whole bill** when the cart has both companies: (a) split it across the two
   invoices in proportion to each one's total, *or* (b) only allow discounts per company.
2. **Which invoice a payment pays first** when the customer pays part now: (a) the tyre company
   first, then services, *or* (b) both in proportion.
3. **Quotes with tyres and services**: (a) one quote numbered under the tyre company, showing a
   subtotal per company, then two invoices when accepted, *or* (b) two separate quotes.
4. Company details (names, BRN, VAT number, prefixes, logos), the web address and the tablet app
   name: I'll use placeholders until you send them. The client's accountant should confirm the split.

## Risks I'm watching
- The database is shared with Carfectionist's live shop: phases B and C go live for Carfectionist
  as soon as they are pushed, even before any screen changes. That is why the backfill copies the
  counters exactly and each phase is proven on the sandbox first.
- Tablets in the field keep calling today's functions, whose signatures stay the same, until the
  new app installs; then the replay rule in phase G protects sales in flight.
- Function bodies patched in place: I start from the live copies (phase A), not the files.
