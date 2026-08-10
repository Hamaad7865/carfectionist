# Service discounts, owner override, and customer points

Date: 2026-08-10
Status: approved

Four rules the owner asked for, on 2026-08-10:

1. No discount on any service — the owner can override.
2. A carwash may be discounted up to 5%, and only if a reason is given.
3. No reversal without an owner override.
4. Customers earn points.

## What the shop has today

The catalogue holds 795 active products. All 102 service rows sit in the single
category `CAR WASH EXPERTS`, which covers both real washes (`WASH & VACUUM
{HATCHBACK,SEDAN,SUV,4X4/VAN}`, `TOUCHLESS FOAM WASH`, `VACUUM ONLY SUV`) and
detailing work costing up to Rs 16,000 (`BODY POLISH`, `CERAMIC PACK`,
`DIAMOND`, `GOLD`, `FULL STEAM VALETTING`, `LEATHER DETAILING`). Nothing in the
data separates a wash from a polish, so rule 2 needs a tag that does not exist
yet.

Three rows are goods wearing `kind='service'` — `SPONGE`, `WHEEL BRUSH`,
`SET 2 SOFT BRUSH`. Rule 1 would freeze them by accident.

Discounts already exist in two places, both VAT-inclusive from the staff's point
of view: per line (`document_lines.discount_pct` / `discount_kind` /
`discount_amount`) and per document (`documents.discount_kind` /
`discount_value`, apportioned across VAT groups by
`app.discounted_vat_groups`). There is no loyalty or points concept anywhere.

Reversal-shaped operations are gated at `owner|manager` today:
`reverse_payment`, `create_and_issue_credit_note`, `void_document`,
`void_quote`, `void_certificate`, `cancel_job`, and reopening a closed day.
`reverse_payment` and the credit-note issuer already demand a reason.

Roles are `owner | manager | cashier | technician | accountant`. Staff PINs
exist: `verify_staff_pin` is service-role only and is reached through a Next.js
route, so a till can verify somebody without logging the cashier out.

## The idea underneath rules 1–3

Every line carries a **discount allowance**: the most, in VAT-inclusive rupees,
that the line may be discounted. Rules 1 and 2 are two values of that allowance;
an owner override raises it. Because a document's allowance is the sum of its
lines', the same rule governs the line discount and the whole-document discount,
so the order-level field stops being a back door.

### Where a line's allowance comes from

A line's effective kind is `coalesce(line_kind, products.kind, 'service')`, as
established by `20260804000020_a_line_knows_if_it_is_work.sql`.

A new column `products.discount_policy text not null default 'inherit'`,
checked against `('inherit','none','carwash','free')`:

| policy | allowance |
|---|---|
| `inherit` (default) | derived from kind: service → `none`, product/consumable → `free` |
| `none` | Rs 0 |
| `carwash` | 5% of the line's gross, **reason required** |
| `free` | the whole line — today's behaviour |

`free` is what rescues `SPONGE` and friends without a data migration, and
`carwash` is what the owner ticks on the seven wash services.

An ad-hoc line has no product, so its stated `line_kind` decides: `service` →
`none`, anything else → `free`.

### The arithmetic

Everything is compared in VAT-inclusive cents, because that is the one unit both
discount forms already share.

```
line_gross_incl   = qty * unit_price * (1 + vat_rate/100)
line_discount_incl = percent ? line_gross_incl * discount_pct/100
                             : min(discount_amount, line_gross_incl)

allowance(line)   = free    -> line_gross_incl
                    none    -> 0
                    carwash -> round(line_gross_incl * 0.05, 2)

ceiling(doc)      = Σ allowance(line)
actual(doc)       = Σ line_discount_incl + order_discount_incl
```

`order_discount_incl` is measured the way `app.discounted_vat_groups` already
measures it — against the gross that remains *after* line discounts:
`percent → round(gross_after_lines * value/100, 2)`, `amount → least(value,
gross_after_lines)`.

Two thresholds, not one:

- `actual > Σ allowance(non-carwash lines)` → the discount is dipping into a
  carwash allowance → **a reason is required**.
- `actual > ceiling` → **an owner override is required**.

Splitting them keeps the reason box quiet when the discount is entirely covered
by product lines, and makes it appear exactly when rule 2 is in play.

A tolerance of 1 cent absorbs rounding.

The reason lives in a new `documents.discount_reason text` — one box per
document, surfaced in Activity. Not per line: a cashier types one sentence, and
per-line reasons would be theatre.

### Rule 3 — reversals

`reverse_payment` and `create_and_issue_credit_note` change from
`app.require_role('owner','manager')` to: role `owner`, **or** an active owner
override naming that payment or that document. These are the two ways money
leaves the business. The other undo paths — voiding a quote or a certificate,
cancelling a job, reopening a day — keep `owner|manager`, so a manager can still
run the shop.

Both already require a reason; that stays.

## Owner override — one mechanism, two uses

```sql
create table owner_overrides (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references business_settings(id),
  kind         text not null check (kind in ('discount','reversal')),
  ref_type     text not null,            -- 'document' | 'payment'
  ref_id       uuid not null,
  scope        jsonb not null default '{}'::jsonb,
  reason       text not null,
  approved_by  uuid not null references app_users(id),
  created_at   timestamptz not null default now(),
  consumed_at  timestamptz
);
```

For a discount, `scope` is `{"max_discount_incl": <numeric>}` — *"up to Rs X off
this document"*, not a yes/no. Approving Rs 500 therefore cannot be turned into
Rs 5,000 by editing the lines afterwards; the guard compares the actual discount
against the approved figure every time the document is issued.

`consumed_at` is stamped on **reversal** overrides, which are single-use — one
approval must not authorise a second refund. Discount overrides are not
consumed: they are a ceiling, re-checked on every issue, and a document can only
be issued once.

Approval flow, reusing the PIN infrastructure rather than inventing a second one:

1. The cashier exceeds a limit; the client shows an approval dialog (owner
   picker, PIN, reason).
2. `POST /api/override` — a Next.js route holding the service-role key.
3. The route calls `verify_staff_pin`, then a new service-role RPC
   `app.record_owner_override(...)` which insists the verified user is an active
   `owner` in the tenant before inserting the row.
4. The guard in `issue_document` (or in the reversal RPC) finds the row.

The PIN is checked server-side only; the browser and the tablet never see a
hash, and the cashier's own session is untouched throughout.

`app_users.pin_attempts` / `pin_locked_until` already give the brute-force
lockout for free.

## Points

### Storage

```sql
create table customer_points_ledger (       -- append-only
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references business_settings(id),
  customer_id uuid not null references customers(id),
  delta       integer not null,             -- + earned, − redeemed
  reason      text not null check (reason in ('earned','redeemed','adjusted','reversed')),
  ref_type    text,
  ref_id      uuid,
  note        text,
  created_by  uuid references app_users(id),
  created_at  timestamptz not null default now()
);
```

`customers.points_balance integer not null default 0`, maintained by an
after-insert trigger on the ledger. The ledger is the truth; the column is the
fast read. `app.forbid_mutation` guards the ledger against update and delete,
matching the convention already used for append-only tables.

Rates, both on `business_settings`:

- `points_per_100 numeric not null default 1` — points earned per Rs 100 of a
  sale.
- `point_value_rupees numeric not null default 1.00` — what a point is worth
  when spent.

One rate for the whole shop, not a table keyed on category: the earn is a
property of the sale, not of what happened to be on it. A cashier can answer
"how many points do I get?" from the total on the screen.

### Earning

Computed inside `record_payment`, at the point it already detects
`v_paid >= v_doc.total_incl` — an invoice earns once, when it is settled in
full, and only if it names a customer.

The base is the sale total. The share settled *with points* earns nothing:

```
earning_base = total_incl − points_paid_on_this_invoice
points       = floor( earning_base / 100 * points_per_100 )
```

`total_incl` is already net of every discount, so a discounted sale earns on
what the customer actually paid. Excluding the points-settled share is what
stops a balance being recycled — paying with points and re-earning on the same
money would let a customer top themselves up indefinitely.

The lines are not consulted at all.

One ledger row per invoice, `reason='earned'`, `ref_type='document'`.

### Spending

`payment_method` gains `points`. It is a **tender, not a discount**: the bill
total and the VAT are untouched, so points can be spent on a body polish without
colliding with rule 1, and the fiscal core needs no changes at all.

In `record_payment`, `p_method='points'`:

- requires the invoice to name a customer;
- requires no `external_ref` (the branch that demands one is for card/Juice/bank);
- converts `points_needed = ceil(amount / point_value_rupees)`;
- refuses if `points_balance < points_needed`;
- writes the ledger row (`reason='redeemed'`) in the same transaction as the
  payment.

It still lands on an open till, like every other method, so the Z-report's
means-of-payment split stays complete. `expected_cash` sums only `method='cash'`,
so the drawer is unaffected.

Recognised revenue is unchanged and the points liability is settled — the
standard voucher treatment.

### Undoing

`reverse_payment` on a `points` payment credits the points back
(`reason='reversed'`). Reversing any payment that drops an invoice below fully
paid also reverses that invoice's earn row, so points cannot be farmed by paying
and un-paying.

## Where the rules are enforced

In the shared RPCs first, then both UIs — the standing web/tablet parity rule.

- **`save_draft`** persists `discount_reason` and permits an over-limit
  discount. A cashier must be able to save the draft and *then* go and get
  approval.
- **`issue_document`** is the hard fiscal gate and refuses. It is long and has
  been edited by many migrations, so the guard is **spliced** via
  `pg_get_functiondef` rather than retyped — the convention established by
  `20260804000020` and warned about in `20260802000010`, where retyping silently
  reverted a fix.
- **Credit notes are exempt** from the discount guard. A credit note mirrors the
  invoice it reverses; making it re-earn an approval the invoice already had
  would block legitimate refunds.

Error messages carry stable prefixes so the clients can tell "ask the owner"
apart from "you typed something wrong":

- `discount exceeds allowance: …`
- `a reason is required for a carwash discount`
- `reversal requires the owner`

These are deterministic refusals. The tablet must therefore enforce the same
rules *before* queueing an offline sale — a sale that fails the guard on replay
is correctly rejected and has to be rung again with approval, per
`SaleRepository.DETERMINISTIC_ISSUE_REJECTIONS`.

## Client surfaces

Shared arithmetic lives beside the existing authority in
`apps/web/src/lib/money/` — a new `allowance.ts` next to `totals.ts`, mirroring
the SQL exactly, as `totals.ts` already mirrors the generated columns. The
Android app gets the same calculation in Kotlin.

**Web**

- Products: a discount-policy control on the product form.
- `DocumentBuilder`: line and order discount inputs clamp to the allowance; a
  reason field appears when the discount reaches into a carwash allowance; an
  "Owner approval" dialog appears above the ceiling.
- Customer page: points balance and ledger.
- Settings: the earn rate and the point value.
- Payment UI: a Points tender showing the customer's balance.
- Z-report: a Points line in the means-of-payment split.

**Android**

- `QuoteScreen` / `CounterScreen`: the same clamps, reason field and PIN dialog.
- Payment pad: the Points tender.

**Receipts** — `ReceiptCard` (web) and `ReceiptText` / `ReceiptPaper` (tablet)
gain points earned and the running balance, changed in the same commit, per the
receipt-parity rule.

## Testing

Following the house pattern — client-side belief is not evidence; Postgres has
to accept the write.

- `scripts/_verify-discount-allowance.mjs` — a service line refuses a discount; a
  carwash line accepts 5% and refuses 6%; a carwash discount without a reason
  refuses; a mixed document's ceiling is the sum of its lines; an order discount
  cannot exceed it. `BEGIN`/`ROLLBACK` against the live schema.
- `scripts/_verify-owner-override.mjs` — a non-owner PIN is refused; an owner PIN
  raises the ceiling to the approved figure and no further; editing the document
  upward after approval still refuses; an override lets a reversal through.
- `scripts/_verify-points.mjs` — earning fires once on full settlement, earns on
  the discounted total, and ignores the points-settled portion; redeeming debits
  the ledger and refuses an overdraft; reversing a payment returns the points and
  unwinds the earn.
- Vitest for `allowance.ts`, including the canonical VAT vector
  (77,200 / 11,580 / 88,780) proving the undiscounted path is untouched.
- Android unit tests mirroring the allowance cases.

## Order of work

**Phase A — rules 1, 2, 3.** `products.discount_policy`; the allowance functions;
`documents.discount_reason`; `owner_overrides` + the approval route; guards in
`save_draft` and `issue_document`; the reversal tightening; web and tablet UI.

**Phase B — rule 4.** The ledger, the balance and the two rate settings; the `points` enum
value and its usage (separate migrations — PostgreSQL will not let a new enum
value be *used* in the transaction that adds it); earning and spending in
`record_payment`; reversal handling; UI, settings and receipts.

## Deliberately not in scope

- **The duplicated catalogue.** Every one of the 51 distinct services exists
  twice (102 rows). Tagging carwash means ticking both copies, and a cashier
  searching `WASH & VACUUM SEDAN` sees two identical entries. This wants a
  separate dedupe, not a rider on this work.
- Points expiry, tiers, and customer-facing balance notifications.
- Any change to the other reversal paths (`void_quote`, `void_certificate`,
  `cancel_job`, reopening a day), which stay at `owner|manager`.

## Note for implementation

`apps/web/AGENTS.md` warns that this Next.js is not the one in training data.
Read the relevant guide under `node_modules/next/dist/docs/` before writing the
`/api/override` route.
