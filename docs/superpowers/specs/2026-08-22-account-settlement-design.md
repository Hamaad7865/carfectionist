# Account settlement — pay off several invoices in one action

Date: 2026-08-22
Status: approved

A customer can settle their running account: pick several of their open
invoices and pay them off together, instead of opening each one and recording
a payment separately.

## What the shop has today

`documents` rows with `doc_type = 'invoice'` and `status in ('issued',
'partly_paid')` are open. `record_payment` (a `SECURITY DEFINER` RPC gated to
`owner|manager|cashier`) takes one invoice, one method, one amount: it locks
the till session (`FOR SHARE`, racing `close_service`'s `FOR UPDATE`), inserts
one `payments` row, recomputes `documents.amount_paid` and flips `status` to
`paid`/`partly_paid`, and — if the invoice is now fully paid and carries a
`job_id` — delivers a `ready` job.

`RecordPaymentForm` (`apps/web/src/features/documents/RecordPaymentForm.tsx`)
is the only caller today, on the single-document page
(`/sales/[id]`). It already establishes the pattern this feature extends:
points are not a tender, they come off the total first as their own
`record_payment` call with `method = 'points'` (which itself calls
`spend_points`, debiting the customer's ledger), and whatever remains is
recorded as a second call in the chosen method. The two calls are **not**
wrapped in one transaction — the form deliberately accepts that a failure
between them leaves a partial, clearly-reported state ("`Rs X` in points was
taken, but the rest failed: `<error>`"), rather than adding a new RPC to make
the pair atomic.

Two read paths already compute "what a customer owes," and they disagree
slightly:

- `getContacts` (`apps/web/src/lib/supabase/queries/contacts.ts`) sums
  `total_incl - amount_paid` over every `issued`/`partly_paid` invoice for the
  customer — it does **not** exclude invoices that have since been credited by
  a `credit_note`.
- `getCustomerAgedStatement` (`apps/web/src/lib/supabase/queries/reports.ts`)
  does the same sum but first removes any invoice that has a `credit_note`
  pointing at it via `source_document_id`. This is the query behind the
  Statement of accounts pages and is the trustworthy one — a fully-credited
  invoice with a non-zero `total_incl - amount_paid` would otherwise still
  look "owed."

The Contacts customer-detail page (`apps/web/src/app/(app)/contacts/page.tsx`)
already shows an "Outstanding balance" card per customer. The Reports →
Statement of accounts per-customer view (`.../reports/page.tsx`, `report ===
"statement"`) already lists every open invoice for that customer in a "Credit
invoices" table (date, number, line detail, amount owed) — this is the exact
list a settlement needs, already correctly filtered. That page is gated to
`owner|manager|accountant` at the layout level (`reports/layout.tsx`); Contacts
carries no such gate, so cashiers reach it.

Legacy Cashmag debt lives as a note on `customers.notes`, parsed by
`parseLegacyBalance` — it is not a document and nothing can be recorded
against it.

## What's being added

**A shared invoice-picker + payment panel**, used from two entry points:

1. **Contacts → customer detail** — a "Settle account" button beside the
   existing "Outstanding balance" card, visible whenever that balance is > 0.
   Opens the panel with nothing pre-selected.
2. **Reports → Statement of accounts (per-customer view)** — the existing
   "Credit invoices" table gains a checkbox per row and a settle bar. Rendered
   for owner/manager only (see Roles below), even though accountant can view
   the rest of the page.

Both mount the same client component and call the same server action, so
behavior can't drift between the two surfaces.

**Invoice list source of truth.** The picker is populated by the same
selection `getCustomerAgedStatement` already computes — `doc_type =
'invoice'`, status `issued`/`partly_paid`, credited invoices excluded. This is
extracted into a small shared helper (`getSettleableInvoices(customerId)`
returning `{id, number, issueDate, outstandingCents}[]`, oldest first) so both
`getCustomerAgedStatement` and the new picker read the same list — the
Contacts page's own (looser) balance figure is left as display-only and is not
touched by this feature.

**Selection model.** Checking an invoice always adds its full
`outstandingCents` to the running total — there is no per-invoice partial
amount. This keeps the picker to a plain checkbox list with a running total
and a "select all" shortcut, and guarantees every settled invoice ends up
`paid`, never left newly `partly_paid`.

**Payment panel**, shown once at least one invoice is checked — the same
building blocks as `RecordPaymentForm`, sized to the selection total instead
of one invoice's balance:

- Total due = sum of `outstandingCents` for checked invoices.
- Optional "apply points" toggle (only shown when the bill has a customer and
  the shop's points switch is on), capped at `min(total due, points value)`,
  editable down like the single-invoice form.
- Method selector (cash/card/Juice/bank transfer) for whatever remains after
  points.
- Cash: tendered field + computed change, same layout as
  `RecordPaymentForm`.
- Non-cash: external reference field, required, same as today.

**Allocation algorithm**, run server-side in the new action:

1. Sort the checked invoices oldest-first by `issue_date` (nulls last).
2. Walk the list maintaining `remainingPoints` (starts at the applied points
   amount) and `remainingTendered` (cash only; starts at what the customer
   handed over):
   - `pointsForThis = min(remainingPoints, invoice.outstandingCents)`. If > 0,
     call `record_payment(invoice, method='points', amount=pointsForThis)`.
     Subtract from `remainingPoints` and from this invoice's remaining
     balance.
   - `methodForThis = invoice's remaining balance after points`. If > 0, call
     `record_payment(invoice, method=chosenMethod, amount=methodForThis, ...)`.
     For cash, every invoice except the last in the walk is recorded with
     `tendered = methodForThis` (no change); the **last** cash payment in the
     walk receives `tendered = remainingTendered` (whatever's left of what the
     customer handed over), so its `change` resolves to the true overall
     change. Non-cash rows carry the one external reference the user typed,
     on every row.
3. Each `record_payment` call gets its own idempotency key,
   `${settleKey}-${invoiceId}-points` / `${settleKey}-${invoiceId}-method`, so
   a retried submit (e.g. after a dropped connection) can't double-charge an
   invoice that already went through — same idempotency shape
   `RecordPaymentForm` already uses per-payment.

Steps 2–3 run as a sequence of independent RPC calls from the server action,
**not** inside one database transaction — this mirrors the existing
points-then-cash sequencing in `RecordPaymentForm` rather than introducing a
new all-or-nothing RPC. `record_payment` itself keeps its per-invoice
guarantees (till lock, idempotency, amount validation); this feature adds no
new SQL.

**Partial failure.** If invoice 3 of 5 fails (someone else just paid it
concurrently, the till session closed mid-walk, etc.), invoices 1–2 are
already real. The action returns how far it got; the panel reports "Settled 2
of 5 invoices (`Rs X`). Failed on `INV-00123`: `<error>`" and refreshes —
the two settled invoices drop out of the picker because they're no longer
open. The user can immediately retry with whatever remains checked.

**Roles & till.** The server action requires `owner|manager|cashier`, matching
`record_payment`'s own DB-level role check — accountants can view the
Statement page but the settle control is not rendered for them, so there's no
button that would only fail once clicked. Exactly like
`recordPaymentAction`, the action binds every payment to the back-office desk
till via `backOfficeTillId(sb)`.

**Validation before any RPC call.** The action re-fetches the selected
invoices' current `outstandingCents` server-side (never trusts the client's
copy) and rejects upfront if: no invoices are selected, the typed points
exceed the cap, or (cash) tendered is less than the total due after points.
This avoids starting a partially-successful walk over stale amounts.

## Out of scope

- The legacy carried-forward Cashmag balance (`customers.notes`) is not a
  document and isn't touched by settlement.
- No new receipt or combined PDF is generated. Each settled invoice's own
  document page reflects its new `paid` status exactly as it would after any
  other payment; the Statement page reflects the new balance on next load.
- Per-invoice partial amounts (paying less than what's owed on a checked
  invoice) are not supported — checking an invoice always pays it in full.
- `getContacts`' looser outstanding-balance figure (which doesn't exclude
  credited invoices) is not changed by this work.

## Testing

- `record_payment` behavior is already covered; this feature adds no new SQL,
  so no new migration tests are needed.
- New coverage for the allocation algorithm (pure function, no DB): oldest-
  first ordering, points splitting across an invoice boundary, cash
  tendered/change landing correctly on the last row, and the non-cash
  external-ref path.
- A script-level probe (in the style of `scripts/_verify-points.mjs`) that
  settles two real open invoices for a live customer against a real till
  session and asserts both end up `paid`, with the right `payments` rows and
  the right points ledger delta.
- Manual verification in the browser: settle from both entry points, confirm
  a partial-failure message renders sensibly (e.g. by settling an invoice
  that's simultaneously paid from another tab).
