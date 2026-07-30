# Catalogue history line

**Date:** 2026-07-30
**Status:** built

## The problem

Standing in the catalogue, the owner can see that WIPER 16 has 8 on the shelf and
168 in the warehouse. What they cannot see is how it got there — whether the last
movement was a sale, a transfer, or somebody correcting a miscount. Answering
"who bought this" meant leaving the list for the Inventory tab or the sales
journal, and then finding the way back.

## What was built

Each catalogue row gains a chevron at its right edge. Clicking it slides a panel
open under the row showing the last 8 things that happened to that item, newest
first, one line each:

```
29 Jul 14:53   +3   Shop        Transfer     from Warehouse       Anesh
29 Jul 14:53   −3   Warehouse   Transfer     to Shop              Anesh
28 Jul 23:13   +3   Warehouse   Adjustment   import: set on-hand  Anesh
27 Jul 12:44   −2   Shop        INV-0035     Walk-in customer     Anshika
```

The quantity carries the colour — red out, green in. `INV-0035` links to
`/sales/<id>`, so the receipt is one click from the price you were checking.

Clicking anywhere else on the row still opens the edit form, unchanged.

## Decisions

**Every movement, not only sales.** A stock drop explained by a transfer or a
manual correction is as much of an answer as a sale is. Filtering to invoices
would leave the other drops looking unexplained.

**A chevron rather than making the row expand.** The row already opens the edit
form and the owner has that habit; the chevron adds a gesture instead of
retraining one. It also keeps the history's links out of the row's `<button>`,
where an `<a>` would be invalid markup and would fire the edit modal on click.

**Transfers show as two lines, not one.** A transfer writes two movements — out
of one location, into another. Each line states its own location and sign, which
reads correctly on its own; folding them into a single synthetic row would mean
inventing a record the ledger does not have.

**Services fall back to billed lines.** ~51 of the 397 catalogue items are
services with no stock ledger at all, so their chevron would open onto nothing.
They read from issued `document_lines` instead: date, count, document, customer.
Nothing moved, so those rows are counted (`×1`) rather than coloured.

**Purchases are not links.** `/purchases` has no detail page. A linked-looking PO
would be a dead end, so the row names the supplier as plain text.

## How it works

### `product_recent_activity(p_product_id uuid, p_limit int default 8)`

`supabase/migrations/20260730000050_product_recent_activity.sql`

One Postgres function rather than three round trips from the app, for two
reasons. `stock_movements.ref_id` is polymorphic — no foreign key, pointing at a
document *or* a job *or* a PO *or* a transfer — so PostgREST cannot resolve the
document number itself. And the products-vs-services split belongs in one place
rather than duplicated in the client.

It returns a flat, already-joined row set: when, how many, `source`
(`movement` | `line`), `kind` (the ref or doc type), the ref id to link to, the
location, the document number, the "other side" of the event (customer,
supplier, or the transfer's far end), the note, and who did it.

`security invoker` — the plpgsql default — so the caller's RLS still decides what
they may see. A row they cannot read comes back with a null label rather than an
error.

### `activity.ts`

Pure shaping: one ledger row in, one display row out — label, optional link, one
detail line. Every event kind renders as the same shape, so the column edges stay
put down the list. Also holds `shortWhen`, which formats in Mauritius local time
without `Intl`, matching the rest of `mu-date` so workerd and the browser agree.

### `ProductActivity.tsx`

Fetches on first expand, never with the page — 397 products' worth of ledger is
not worth loading for a page mostly opened to check a price. Stays mounted while
collapsed so a close-and-reopen doesn't refetch. Opens by animating
`grid-template-rows` from `0fr` to `1fr`, which needs no measured height, and is
disabled under `prefers-reduced-motion`.

Loading shows three skeleton lines; a failure shows "Couldn't load history" with
a retry, rather than an empty panel that reads as an empty history.

## Scope

Back office only. The tablet's Stock screen is deliberately narrower — a
shop-floor view for quick adjustments — and has no catalogue rows to hang this
off, so no parity mirror is owed. The function is callable from the tablet
unchanged if that changes.

## Verification

- `activity.test.ts` — 12 cases over the shaping: each `kind` to its label, link
  and sign; boilerplate ledger notes suppressed; a sale whose number RLS hid
  still links; MU time and its midnight rollover.
- `scripts/_verify-product-activity.mjs` — probes the live DB with the role
  switched to `authenticated` and JWT claims set, so RLS and the grant are
  exercised rather than bypassed. Covers a stocked product, a service, a product
  that never moved, and an id that is not a product.
- Browser: expand, collapse, cached refetch, the invoice link's href, the row
  click still opening the edit form, and the mobile layout not colliding with
  the chevron.
