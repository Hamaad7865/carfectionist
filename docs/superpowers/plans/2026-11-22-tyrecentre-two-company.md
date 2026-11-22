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

**Phase C as built (2026-11-23, `20261123000010_two_company_checkout.sql`, proven by
`scripts/_verify-two-company-checkout.mjs` — rolled back, ALL GOOD):**
- `issue_checkout(draft, location, key, session, discounts)`; `split_document_by_company` ("two
  quotes"); `checkout_document_ids` (the ids a split will use — the first company keeps the draft id,
  the others `md5(draft:company)`, so an owner approval can name them in advance).
- `record_checkout_payment(invoice_ids[], method, amount, tendered, ref, till, allocation, key)` +
  `payment_groups` (append-only) + `reverse_checkout_payment`. Change rides on one part only. Points
  pay one bill at a time.
- One invoice per job / per quote is now one per company inside a checkout group; every invoice
  without a group (all of Carfectionist's) is covered exactly as before.
- `record_payment`: the car is handed back only when every company's bill is settled.
  `cancel_job`: every bill of the job is resolved.
- A quote spanning companies cannot carry a bill discount (line discounts are per company already).
- Web: the counter and the document page's Issue use `issue_checkout` only when the shop has more
  than one active company; Carfectionist keeps `issue_document`.
- Left as is, on purpose: `deliver_on_account` hands the car over when ONE bill goes on account (the
  customer leaves owing the visit either way); `save_draft`'s 15% fallback (the line trigger forces 0
  for a non-VAT company); the discount allowance (`default_policy_service = none` refuses any discount
  on a service unless the owner approves) — the tyre centre's own setting, chosen in phase E.
- Z report per company is phase D; the Z total balances already (it sums invoices).

### D. Receipts, A4 invoices and reports (web)
- Receipt and A4 read the issuing company: legal name, BRN and VAT number from the issue-time
  snapshot, address/phone/logo/footer from the company row — not the live business settings.
  VAT and non-VAT variants; legal fields never hidden on a VAT invoice.
- Sending by email/WhatsApp sends every invoice of the checkout.
- Z report, sales journal, VAT report, period close, CSVs: per company + combined.
- Tests: receipt fixtures for both company types; a one-company tenant renders byte-identical.

**Phase D as built** (branch `tyrecentre-two-company`, migration `20261123000020`):
- `lib/supabase/queries/issuer.ts`: the issuing company's identity laid over the shop's settings
  (the default company = the settings row, untouched). Receipt slip, A4 ticket and A4 invoice print
  it; a non-VAT company prints "INVOICE" (not "VAT INVOICE"), no VAT number, no VAT rows, and
  "Not registered for VAT". Carfectionist's paper is byte-identical (tested).
- `app.z_totals` + `close_period` gain a `companies` key only when the shop has more than one active
  company (sales, excl, VAT, refunds and money by method per company; history with no company is the
  default company's). The Z A4 prints a "By company" block from it. A one-company shop's Z and month
  close are byte-identical JSON (proved on the live shop and the sandbox, rolled back).
- Sales journal: one "SALES [COMPANY]" sale-method row per company, a Company filter in More filters
  (two-company shops only); every section still foots. Reports → VAT: a "By company" table
  (invoiced, output VAT) and the same rows in the VAT CSV.
- Not yet: sending every invoice of a checkout in one email/WhatsApp (phase E, with the Paid panel);
  expenses carry no company, so all input VAT counts against the shop (the service company cannot
  reclaim VAT anyway — a "Paid by" on expenses if the accountant needs it); the tablet Z slip
  (`ZSlip.kt`) and receipt non-VAT variant are phase G (receipt parity).

### E. Web screens
- Settings → **Companies** (owner): list, add, edit; numbering and VAT status lock once the company
  has issued anything.
- Product form, import and export: **Sold by** column.
- Tyre Centre New sale: one bill block per company with its own subtotal/VAT, one grand total, one
  Charge; the Paid panel shows both invoice numbers and both receipts. No invoice number shows
  before the charge succeeds.
- Carfectionist counter: unchanged (one company → one bill, no new UI).

**Phase E as built** (branch `tyrecentre-two-company`, migration `20261124000010`):
- Settings → Companies (owner only): list, add, edit; prefixes, numbering and VAT status lock once a
  company has issued anything. Changing a company's VAT status before it has issued moves its
  products' VAT rate with it.
- Products: a **Sold by** select on the product form (two-company shops only). A product sold by a
  non-VAT company is held at 0% VAT by the database (trigger), so the till and the bills cannot
  disagree; the "price includes VAT" box is hidden for it. Export adds a `sold_by` column and import
  reads it (legal name, trading name or invoice prefix; an unknown company refuses the row) — both
  only when the shop has more than one company. `import_products` keeps one overload, no anon grant.
- Tyre Centre New sale: one bill block per company (its own lines, subtotal, VAT or "No VAT", and
  its own discount with its own owner-approval), one grand total, one Charge. Split payment asks
  which bill fills first: Tyres first / Services first / Both (proportional). The Paid panel lists
  every invoice number and prints all receipts in one go (`/print/receipt/{id}?also=…`, one per page).
- Make a quote on a two-company cart asks **One quote or two?** Two quotes = one per company, each
  numbered in its own series with its own discount; one quote cannot carry a discount (refused with
  a message, the dialog greys that option out). A job covering both companies cannot carry a
  discount yet (refused with a message).
- Invoice page: a **This sale** panel when the invoice is one of a checkout's bills — the sibling
  bills with their totals and balances, **Collect for the whole sale** (one payment across the open
  bills, with the pay-order choice, on the back-office till) and **Send all**.
- Reports → payments CSV: a Company column (two-company shops only).
- Carfectionist: one company → no new UI anywhere; its numbers and product VAT rates were checked
  untouched by both proofs.
- Proofs (TEST Sandbox, rolled back): `scripts/_verify-companies-admin.mjs`,
  `scripts/_verify-two-quotes-and-collect.mjs`. Screenshots: `docs/redesign/phase-e/`.
- Not yet: the tablet's non-VAT receipt and Z slip (phase G); the document builder's own Issue
  button still returns the first bill only (the This sale panel shows the others); expenses carry no
  company; refunds across both companies' bills are untested; the tablet calling `issue_document`
  directly on a mixed invoice stays a risk until phase G routes it through `issue_checkout`.

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

**Phase F as built** (branch `tyrecentre-two-company`, no migration; mock-up approved in Kite,
copy at `docs/redesign/phase-f/dashboard-mockup.png`):
- `/dashboard` on the tyre-centre host is now "Overview"; Carfectionist's dashboard is untouched.
- Today strip: one card per company (sales today against the same weekday last week **up to the
  same time**, number of sales), money collected today by method, cars on site (and how many are
  ready to pay), money owed (count, oldest in days). Money owed uses the same count as the bell and
  the sidebar (`outstandingTotals` in `notifications.ts`), so the three never disagree.
- Sales: 7 / 30 / 90 days, period total and change against the period before, each company's share,
  VAT collected (a non-VAT company adds none), one stacked bar per Mauritius day in the companies'
  colours, today ringed in lime. Credit notes count against their day. Rows with no company count
  to the default company (the Z report's rule).
- In the bays: On site / Booked today / Handed back today, with technician, the four stages (red
  when paused), which companies bill the job, status ("Ready to pay" only while a bill is owed) and
  time on site (days once past a day).
- Top sellers this month: tyres grouped by size whatever the brand, services by name.
- Needs you: money owed, low stock (the bell's own count), a till left open from an earlier day,
  new enquiries — each with one action; "Nothing needs you right now" when clear.
- Every source loads on its own: one failing read shows "Couldn't load…" in its card, never a
  broken page. Skeleton while loading; Refresh re-reads everything.
- Removed: the earlier Copilot dashboard (`DashboardCharts.tsx`, `tyrecentre-dashboard.ts`) and
  the three Easy UI chart pieces only it used.
- Not shown yet, because the system doesn't record them: discount approvals waiting.

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

**Phase G so far** (branch `tyrecentre-two-company`):
- *Part 1 — two apps (2fb0dfd).* Flavors `carfectionist` (id, name, look and `latest.json`
  unchanged) and `tyrecentre` (`mu.haz.tyrecentre.pos`, "Tyre Centre POS", DESIGN-SPEC tokens,
  Manrope/Archivo/JetBrains Mono, own icon, `tyrecentre/latest.json`). `publish-apk.mjs --brand`.
  Both build; 561/561 unit tests each; Carfectionist debug installs over 0.1.725 on the emulator
  and its sign-in looks unchanged; Tyre Centre installs beside it.
- *Part 2 — the money path.* The tablet asks the server how many companies the shop has at every
  sale. One (Carfectionist): `issue_document` / `record_payment` exactly as before, same draft id
  and keys. Two or more: `issue_checkout` under the same `$saleKey:issue` (one invoice per
  company; a one-company cart is still one invoice), then ONE `record_checkout_payment` across
  the bills under `$saleKey:pay` (a split: one per part, `$saleKey:pay:i`). A lost response on a
  two-company sale is retried by re-running the whole road — the draft save refuses, both issue
  and payment replay — never by settling only the first bill. Offline sales replay the same way.
  The done panel's undo voids / credit-notes every bill. New refusals (bill discount across two
  companies, Rs 0 bill, points across two bills, …) leave the basket live.
- *Part 3a — each company's slip.* On a shop with several companies every sale prints one slip
  PER BILL, rebuilt from the server and printed under the company that issued it (tablet
  `overlayIssuer`, the twin of the web's `issuer.ts`; a services-only cart is one bill of the
  non-VAT company and prints as such). The non-VAT company's slip reads "NUM INVOICE", has no
  "excl. VAT", no TAUX block, no VAT number, and says "Not registered for VAT — no VAT charged".
  Reprints, collects, Jobs and Settlement (one consolidated receipt per company) use the bill's
  own company. A bill whose company cannot be read prints no slip rather than the wrong one.
  Carfectionist's slip is byte-identical (existing receipt tests unchanged); 568/568 tests each.
  Known: the tablet caches one logo — a company with its own logo prints its name instead; a
  company borrowing the shop logo shows no name line (as on the web).
- *Still to do:* per-company discounts and the pay order on the till (needs each product's
  company on the tablet); the Tyre Centre Till and Paid screens (`docs/redesign/screens/
  tablet-till.png`, `tablet-paid-receipts.png`); ZSlip per company. The offline provisional slip
  stays one slip (it is not a fiscal document).

### H. Final checks
`npm run test --workspace web`, typecheck, lint on touched files, `cf-build`, both Android
debug builds, before/after screenshots next to the mockups, `PROGRESS.md` entry listing any
sandbox test rows. Then I ask you before any merge to `main` (which deploys).

## Decisions (owner, 2026-11-22)

1. **Discounts are per company only.** A bill-wide discount is not offered when the cart has more
   than one company; each company's bill block has its own discount (with its own reason and the
   same owner allowance rules). A one-company cart (Carfectionist) keeps today's bill discount.
   The database refuses a bill discount on `issue_checkout` with lines from two companies.
2. **Part payments: staff choose where the money goes.** The pay screen offers
   **Tyres first** (fill the tyre invoice, the rest to services), **Services first**, or **Both**
   (split in proportion to what each still owes, to the cent, remainder to the larger bill).
   Paying in full needs no choice. The group payment call takes the chosen order
   (`entity_first: <company> | proportional`), so web and tablet allocate identically.
3. **Quotes: both ways.** When the cart has both companies, "Save as quote" offers
   **One quote** (numbered in the default company's quote series, a subtotal block per company,
   two invoices when accepted) or **Two quotes** (one per company, each in its own company's quote
   series, linked by `checkout_group_id` so they can be accepted together).
4. **Company details** come from the owner later; placeholders until then.

## Risks I'm watching
- The database is shared with Carfectionist's live shop: phases B and C go live for Carfectionist
  as soon as they are pushed, even before any screen changes. That is why the backfill copies the
  counters exactly and each phase is proven on the sandbox first.
- Tablets in the field keep calling today's functions, whose signatures stay the same, until the
  new app installs; then the replay rule in phase G protects sales in flight.
- Function bodies patched in place: I start from the live copies (phase A), not the files.
