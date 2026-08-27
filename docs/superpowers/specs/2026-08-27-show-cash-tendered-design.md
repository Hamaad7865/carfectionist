# Show what the customer handed over (cash tendered) on web

**Date:** 2026-08-27
**Status:** Approved

## Problem

A walk-in pays an Rs 825 bill with a Rs 1,000 note and gets Rs 175 change.
On the web the sale reads as a contradiction:

- **Payments panel** (sales detail): `Cash — change Rs 175.00 … Rs 825.00 · paid in full`.
  Nothing on the row says Rs 1,000 was handed over, so the change looks unexplained.
- **Receipt / ticket** (`ReceiptCard`): tender row prints `1   CASH : 825.00Rs` then
  `Change : 175.00`. Same problem, and it **disagrees with the tablet**, whose slip
  already prints `1   CASH : 1000.00Rs` + `Change : 175.00`
  (`core/data/SaleReceipt.kt:107`, locked by `SaleReceiptTest.kt` — the owner asked
  for exactly this). This is a live web↔tablet receipt-parity gap.

The data is already there: `record_payment` stores `payments.tendered` and
`payments.change_given`; the web already carries `PaymentView.tenderedCents`
(`queries/document.ts:255`) and `ReceiptData.changeCents`. This is display-only.

## Scope

Bring every **web** surface in line with the tablet. No DB change, no tablet change
(the tablet slip is the reference and is already correct).

| Surface | File | Change |
| --- | --- | --- |
| Receipt / ticket slip | `lib/supabase/queries/receipt.ts` (`receiptTenders`) | Fold `change_given` into the tender row so the cash row shows what was tendered, matching the tablet. `ReceiptCard.tsx` needs no edit — it renders `p.amountCents`. |
| Payments panel | `app/(app)/sales/[id]/page.tsx` | Replace the lone `change …` span with `given {tendered} · change {change}`. |
| A4 ticket "Payment details" | `components/pdf/TicketA4.tsx` | **No change.** It is a dated règlement ledger with an Amount column and no Change column; "amount applied to this invoice" (825) is the correct meaning there. Listed so the "all surfaces" intent is deliberate, not an oversight. |

## Design

### 1. `receiptTenders()` — fold change into the tender row

`receiptTenders(payRows)` is called with raw `payments.*` rows
(`receipt.ts:276` is `select("*")`), so `id` and `change_given` are available.

- Widen `ReceiptPaymentRow`:
  `{ id?: string; method; amount; change_given?: number | string | null; reverses_payment_id?: string | null }`.
- Inside, compute `reversedIds` from the rows (same as the caller does at
  `receipt.ts:365`).
- For each **non-reversal** row, add its change back:
  `amountCents += rupeesToCents(amount) + change`, where
  `change = (!reversedIds.has(id) && change_given != null) ? max(0, rupeesToCents(change_given)) : 0`.
- Reversal rows are untouched (still their own negative row).

Guard rationale: the caller already gates the `Change :` line on
`!reverses_payment_id && !reversedIds.has(id)` (`receipt.ts:370`). The tender row
must use the **same** gate, or a reversed cash payment would print
`CASH : 1000.00` with no `Change` line to explain the 175 gap.

Result for INV-0176: `1   CASH : 1000.00Rs` + `Change : 175.00` — byte-identical
to the tablet. Split bills where change lands on one leg still sum correctly
(mirrors `SaleReceiptTest.kt`: two cash legs + change → one `7000.00` row).

`ReceiptData.paymentDetail` and `changeCents` are unchanged.

### 2. Payments panel sub-line

`app/(app)/sales/[id]/page.tsx` ~line 476, current:

```tsx
{p.changeCents != null && p.changeCents > 0 && <span className="ml-2 text-[11px] text-faint">change {formatMUR(p.changeCents)}</span>}
```

becomes, only when there is change **and** a tendered figure:

```tsx
{p.changeCents != null && p.changeCents > 0 && p.tenderedCents != null && (
  <span className="ml-2 text-[11px] text-faint">
    given {formatMUR(p.tenderedCents)} · change {formatMUR(p.changeCents)}
  </span>
)}
```

Right-hand headline stays `formatMUR(p.amountCents)` (825) so the running
`runningCents` / "paid in full" math (`page.tsx:463-489`) is untouched. Card and
exact-cash payments (`changeCents === 0`) render exactly as today.

## Tests

- `lib/supabase/queries/receipt.test.ts` — add to the `receiptTenders` block:
  - a cash row with `change_given` → `amountCents` is `amount + change`;
  - a **reversed** cash row with `change_given` → change is **not** folded in
    (kept amount only), reversal still its own row;
  - existing cases (no `change_given`) stay green unchanged.
- `components/pdf/ReceiptCard.test.tsx` — **no new test.** The component renders the
  `ReceiptTender` it is handed; `receiptTenders` builds that value and is where the
  behaviour changed. A `ReceiptCard`-level case passing a pre-folded tender would
  pass without any code change (already covered by the existing "tender rows" cases).
- Payments panel is a server component with no test harness; the shared logic is
  covered by `receiptTenders` tests and the change is verified in the browser
  preview (sales detail for an invoice paid with change).
- Tablet tests unchanged.

## Out of scope

- Any change to `payments` schema or `record_payment`.
- Tablet UI / slip (already correct).
- A4 ticket ledger (correct as-is — see Scope table).
- Multi-currency, rounding rules, non-cash "change".
