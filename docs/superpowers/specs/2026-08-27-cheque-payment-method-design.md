# Cheque payment method — web + Android

## Goal

Add `cheque` as a first-class non-cash payment method everywhere `card` / `juice` /
`bank_transfer` already appear, on both the web app and the Android tablet.

## Behaviour

A cheque is a non-cash tender. It settles the invoice immediately (no clearing
lifecycle — that is explicitly out of scope). Like card / Juice / bank:

- It must be taken **on an open till** (the till gate, `20260716000040`) so it lands
  on a Z-report — but it does **not** move the physical cash drawer and is **not**
  part of the expected-cash count.
- It appears as its own line on the cash-up screen, the Z-report, the sales journal,
  customer statements and the dashboard/reports method split.

Difference from card/Juice/bank: the **reference (cheque no.) is optional**. The
field is shown on both platforms but may be left blank, and a blank reference is
stored as `NULL` (not a placeholder like `"COUNTER"`/`"POS"`).

## Precedent

The `points` tender (`20260811000010` + `…040` + `…080`) is the template: add the
enum value in its own migration, then patch the CHECK constraint and splice
`record_payment` in a second migration. `pre_close_summary` and `close_service`
already build their method list dynamically, so the cash-up picks `cheque` up with
no further migration — to be **verified by probe**, not assumed.

## Database — 2 new migrations

1. `20260827000010_cheque_is_a_way_of_paying.sql` — **only**
   `alter type payment_method add value if not exists 'cheque';`
   (Postgres forbids using a new enum value in the transaction that adds it, and
   `db-exec` sends a file as one transaction.)

2. `20260827000020_cheque_can_settle_a_bill.sql`
   - Widen `payments_check3`:
     `check (method = 'cash' or reverses_payment_id is not null or external_ref is
     not null or method = 'points' or method = 'cheque')` — a cheque row is valid
     with a `NULL` external_ref.
   - Splice `record_payment` (via `pg_get_functiondef` + `replace`, guarded, like
     `…040`): change the non-cash `else` branch anchor
     `if p_external_ref is null then raise exception 'a % payment requires an
     external reference', p_method; end if;`
     to `if p_external_ref is null and p_method <> 'cheque' then raise …`.
   - Assertion block afterwards: the patched body contains `p_method <> ''cheque''`.

No change to `pre_close_summary`, `close_service`, `close_cash_session`,
`expected_cash`, reversal / credit-note paths — cheque follows the existing
non-cash path. Confirmed by the verification probe.

## Web

- `features/counter/CounterSale.tsx` — add `{ key: "cheque", label: "Cheque" }` to
  `METHODS`; grid goes from 5 to 6 buttons (`grid-cols-3`, two rows). The non-cash
  branch already renders the reference input; relabel its placeholder to
  "Cheque no. (optional)" when `method === "cheque"`. Send
  `externalRef: ref.trim() || null` for cheque (no `"COUNTER"` fallback).
- `features/counter/actions.ts` — add `"cheque"` to the `method` enum; in the
  `recordPayment` call, `externalRef` for cheque is `externalRef?.trim() || null`.
- `features/documents/RecordPaymentForm.tsx` — add `{ value: "cheque", label:
  "Cheque" }`; drop the "needs a reference" guard for cheque; pass
  `ref.trim() || null`.
- `features/documents/actions.ts` — add `"cheque"` to `recordPaymentSchema.method`
  and `settleAccountSchema.method`; relax the `!externalRef?.trim()` guard and the
  leg `externalRef` ternary to treat `cheque` like `cash`/`points` (may be null).
- `lib/supabase/rpc.ts` — widen the `method` union on `RecordPaymentArgs`.
- Label maps — add `cheque: "Cheque"` (and a colour where the map has one):
  `lib/method-label.ts`, `lib/supabase/queries/receipt.ts` (`METHOD_LABEL` +
  `METHOD_UPPER`), `lib/supabase/queries/sales-journal.ts` (`METHOD_ORDER` +
  `METHOD_LABEL`), `lib/supabase/queries/reports.ts` (`PAYMENT_METHODS` +
  `STMT_METHOD`), `lib/supabase/queries/activity.ts`, `app/(app)/dashboard/page.tsx`,
  `app/(app)/reports/page.tsx` (incl. the two hardcoded filter arrays),
  `app/(app)/sales/[id]/page.tsx`, `app/(app)/point-of-sale/[deviceId]/page.tsx`.
- Update the affected unit tests (`method-label.test.ts`, receipt/journal tests).

## Android

- `core/data/SaleRepository.kt` — add `CHEQUE("cheque", "Cheque")` to `PayMethod`
  (before `CREDIT`). Replace the four inline ref-normalisation expressions with one
  helper: `cash`/`points` → always null; blank ref → null for `cheque`, `"POS"`
  for card/Juice/bank; a typed ref is kept for cheque.
- `feature/counter/CounterScreen.kt` — add a `CHEQUE` arm to `methodHue` and
  `methodIcon` (both exhaustive `when`); add a `PayMethod.CHEQUE ->
  "Cheque no. (optional)"` case to the ref-placeholder `when`; soften the helper
  text for cheque. `availableMethods` already includes it (only `POINTS` is
  filtered); the 2-column grid grows to three rows — no layout change.
- `feature/counter/CounterViewModel.kt` — add `CHEQUE` to `SPLIT_METHODS`.
- `feature/settlement/SettlementViewModel.kt` — exempt `cheque` from the
  "needs a reference" guard (line ~159).
- `core/network/PosApi.kt` — update the `// cash | card | juice | bank_transfer`
  comment.
- Android receipts already resolve the label from `PayMethod` by `rpcValue`, so
  they print "Cheque" with no further change.

## Verification

- **DB probe** (`scripts/db-exec.mjs`, `BEGIN … ROLLBACK`, sandbox off, live IDs):
  open a till, `record_payment(method => 'cheque', p_external_ref => null)` →
  accepted; the payment shows as a `cheque` row on `pre_close_summary` /
  `close_service`; `expected_cash` is unchanged; a reversal of the cheque payment
  succeeds.
- **Web**: mint an owner session, take a cheque payment at the counter (blank ref),
  check the receipt, the sales journal, the Z-report and the customer statement all
  read "Cheque".
- **Android**: `./gradlew assembleDebug`, deploy to the emulator, ring a cheque sale
  end-to-end on a test device row; confirm the slip prints "Cheque".

## Out of scope

Cheque clearing / bounce lifecycle, post-dated cheque tracking, outstanding-cheque
reporting.
