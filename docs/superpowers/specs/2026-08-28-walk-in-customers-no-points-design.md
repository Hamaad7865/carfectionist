# Walk-in customers cannot earn or hold loyalty points

## Problem

Receipt `INV-0142` — a walk-in sale — printed `Points balance : 54 pts`. Walk-ins
have no loyalty standing, so the line is meaningless to the customer.

The cause is data, not a display bug in isolation: the POS bills every anonymous
counter sale to a real `customers` row literally named **"Walk-in customer"**
(`issueWalkInInvoice` in the Android app — `findCustomerByName("Walk-in customer")`,
created on demand). Only 1 of 274 invoices uses `customer_id IS NULL`; **61** are
billed to a "Walk-in customer" row. There are **two** such rows:

| id | balance | invoices |
|----|--------:|---------:|
| `04a6cf46-3423-4dcd-98a8-39db8c4049fc` | 54 | 51 |
| `7a643866-c8d8-44b6-bebd-c996a0ae95f6` | 826 | 10 (still earning) |

Because these are real customer rows, `app.award_points_for_invoice` credits them
and the web receipt (`receipt.ts`) prints their balance. The Android slip already
hides points for the bucket by matching the name string, but the web and the
database do not know that convention.

`app.award_points_for_invoice` already returns early for `customer_id IS NULL` and
for `points_enabled = false`. The genuine anonymous path is correct; nobody uses it.

## Principle

**Loyalty points require a customer you can identify and contact.** A `customers`
row with no phone *and* no email is functionally anonymous — a walk-in with a name
typed in — and is not loyalty-eligible, the same as `customer_id IS NULL`.

"No phone and no email" is chosen over matching the name string: it is robust to
localisation and renames, it catches a cashier-typed walk-in name
(`issueWalkInInvoice` lets the operator name the walk-in — still no contact
details), and it needs no new column. A real customer with neither detail yet
starts earning the moment one is added.

## Part 1 — Earning / spending guard (database)

`supabase/migrations/20260828000010_points_need_a_reachable_customer.sql`.

Spliced into the live function bodies with `pg_get_functiondef` + `replace()` on a
verified anchor, then asserted — the same mechanism as
`20260811000090` (the points off-switch). Idempotent: re-running is a no-op once
the marker text is present.

**`app.award_points_for_invoice`** — new early return, immediately after the
existing `customer_id IS NULL` check:

```sql
-- No phone and no email on the named customer: it is anonymous — a walk-in with
-- a name typed in — and earns nothing, exactly like customer_id IS NULL above.
if not exists (
  select 1 from public.customers
   where id = v_doc.customer_id
     and (nullif(btrim(phone), '') is not null or nullif(btrim(email), '') is not null)
) then return; end if;
```

**`app.spend_points`** — symmetric guard after its `customer_id IS NULL` check,
but it **raises** (a points tender on such a bill is a mistake, not a shortfall —
same stance as the "points are switched off" raise):

```sql
if not exists (
  select 1 from public.customers
   where id = v_doc.customer_id
     and (nullif(btrim(phone), '') is not null or nullif(btrim(email), '') is not null)
) then
  raise exception 'this customer is not on the loyalty programme (no phone or email)';
end if;
```

This one change covers every earning path — web, tablet, cron, offline replay —
because they all settle through `record_payment`, which calls these functions.

## Part 2 — Display gate (web + Android, receipt parity)

Today the points block shows whenever a customer is attached. Tighten the gate in
three readers to also require the customer be reachable (phone **or** email):

- `apps/web/src/lib/supabase/queries/receipt.ts` — `pointsEarned` /
  `pointsBalanceAfter`. Add `phone` to the embedded `customers(...)` select.
- `apps/web/src/lib/supabase/queries/document.ts` — `customerPointsBalance`
  (drives the sales-detail modal and the Points tender offer). `phone`/`email`
  already selected.
- `android/app/src/main/java/mu/carfection/pos/core/data/SaleReceipt.kt` —
  fold reachability into `namesCustomer`. `SALE_COLS` already fetches
  `customers(name, phone, email, points_balance)`, so no DTO/query change. The
  existing `name != WALK_IN_CUSTOMER` check stays — redundant but harmless, and it
  documents intent.

`reports.ts` statements read real ledger movement and need no change.

## Part 3 — Data cleanup

`supabase/migrations/20260828000020_zero_anonymous_customer_points.sql`.

For every no-contact customer with a non-zero balance (the two rows above), insert
one compensating ledger entry. The ledger is append-only (`app.forbid_mutation`),
so nothing is deleted; the `trg_points_balance` trigger drives `points_balance`
to 0.

```sql
insert into public.customer_points_ledger
  (tenant_id, customer_id, delta, reason, note, created_by)
select tenant_id, id, -points_balance, 'adjusted',
       'Anonymous customer (no phone/email) — not loyalty-eligible; balance zeroed',
       null
from public.customers
where points_balance <> 0
  and nullif(btrim(phone), '') is null
  and nullif(btrim(email), '') is null;
```

Idempotent: after the first run these customers have `points_balance = 0`, so the
`SELECT` returns nothing.

**The rows are not renamed and not deleted.** The Android POS finds the walk-in
bucket by the exact string `"Walk-in customer"` (`findCustomerByName`) and its slip
suppresses points by the same string; renaming would make the tablet spawn a fresh
bucket and start printing points against the old one. The 61 issued invoices are
left untouched — they stay fiscally intact and keep matching the paper the
customer holds.

## Part 4 — Verification

`scripts/_verify-anon-customer-no-points.mjs` — one `BEGIN; … ROLLBACK`, nothing
persists. Applies both migrations inside the transaction, then asserts:

1. A bill on a no-contact customer settles and earns **no** ledger row.
2. A bill on a customer with a phone still earns.
3. `spend_points` against a no-contact customer raises
   `not on the loyalty programme`.
4. The cleanup inserts one `adjusted` row per no-contact customer with a balance,
   and both balances read 0 afterward.

## Non-goals

- Not force-nulling `customer_id` on the 61 issued invoices (fiscal lock; decided).
- No `customers.is_walk_in` column; no name-based blocking of contact creation; no
  mandatory phone/email on the customer form.
- Not changing `issueWalkInInvoice` / the tablet's walk-in bucket design — a larger
  change touching offline sync. The guard makes the bucket inert for loyalty
  regardless.
- Not gating the receipt points block on `points_enabled`. It is a real adjacent
  gap (a named-customer receipt prints a stale balance while the programme is off),
  but closing it means threading `points_enabled` onto `ReceiptBiz` and six Android
  call sites to keep web/tablet identical. Separate change.
