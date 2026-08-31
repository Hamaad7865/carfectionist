# Change a receipt's payment method — web + Android

## Goal

Let a cashier correct the **payment method** on an already-recorded receipt —
Card → Juice, Juice → Bank, etc. — for the **same amount on the same bill**,
without an owner walking over.

## Why it exists

Card terminals are not integrated. The cashier taps **Card** in the POS, the
receipt prints, and only then does the physical PDQ decline the card. The
customer pays another way (usually Juice). Today the recorded Card payment can
only be undone through `reverse_payment`, which is **owner/manager-only**
(`20260810000060`) and demands a typed reason — so the counter stalls.

## Behaviour

Payments are an append-only ledger; nothing is edited in place. "Change the
method" is:

1. Insert the **negative mirror** of the original payment (same method, same
   amount negated) — the standard `reverse_payment` correction shape.
2. Insert a **new payment** for the identical amount on the identical invoice in
   the new method.

Both land on the **same open till session**. Net money movement is **zero** and
the invoice's `amount_paid` / `status` are unchanged once both rows exist — that
is what makes it safe to hand to a cashier.

### What it does NOT touch

Because total paid is invariant across the operation:

- **Points** — no unwind, no re-award. The original earn row stays correct.
- **Job delivery** — a job delivered by the original payment stays delivered;
  `delivered_at` keeps its original timestamp. (Composing `reverse_payment` +
  `record_payment` would bounce the job ready→delivered and rewrite
  `delivered_at` to `now()` with two extra audit rows — this RPC deliberately
  does not.)

### Guards

- **Same amount only.** Changing the figure stays on the existing reverse +
  re-collect path.
- **Till still open.** The session the original payment was booked on (or its
  rolled-forward sibling for the same device — the `reverse_payment` lookup) must
  be `open`. No open session → the RPC refuses and the owner correction path is
  the fallback. (Web books to the back-office till, which auto-rolls, so this
  always passes there.)
- **Cash carve-out.** Changing a payment **away from `cash`** still requires
  owner/manager — turning a recorded cash sale into "card" removes the
  expectation that the cash is in the drawer (a theft vector). Changing **to**
  cash is fine for a cashier (the drawer is then expected to hold it).
  Non-cash → non-cash — the real case — is always allowed for a cashier.
- **`points` and `credit` are out.** Neither side of the swap may be `points`
  (needs a balance debit/credit). `credit` is not a `payment_method` enum value
  at all — a UI-only pseudo-tender — so the type system already keeps it off
  both sides; the RPC only needs the explicit `points` guard. A declined card is
  never either.
- **No-op rejected.** New method must differ from the current one.
- **Not on a reversal / already-reversed / credit-noted payment** — same
  refusals `reverse_payment` already makes.
- **New method's own rules apply** — `card` / `juice` / `bank_transfer` need a
  reference; `cheque`'s is optional; `cash` needs tender ≥ amount (defaulted to
  exact, change computed).
- **Idempotent** — an `idempotency_key`, like every other money RPC.
- Writes one `payment_method_changed` audit event
  (`{original_payment_id, new_payment_id, from_method, to_method, amount,
  invoice, booked_session}`) with an auto-filled reason
  (`"method changed at POS: <from> → <to>"`). The cashier types nothing beyond
  the new reference.

## Database — 1 new migration

`supabase/migrations/20260831000010_a_receipt_can_change_how_it_was_paid.sql`

New function
`public.change_payment_method(p_payment_id uuid, p_new_method payment_method,
p_new_external_ref text default null, p_session_id uuid default null,
p_idempotency_key text default null) returns payments`
— `SECURITY DEFINER`, `search_path = public, pg_temp`.

Body, one transaction, spliced from the **live** bodies of `reverse_payment` and
`record_payment` (not the migration files — both have been rebuilt many times):

1. `app.require_role('owner','manager','cashier')`. No
   `require_owner_or_override` — this is not a free reversal.
2. Idempotency: `pg_advisory_xact_lock(hashtext(tenant || ':' || key))`, return
   the stored payment row if the key was already used.
3. Lock the original payment `for update`; load + validate:
   `amount > 0`, not itself a reversal, not already reversed, invoice not
   `void`, no live credit note against the invoice.
4. Reject `v_orig.method in ('points','credit')` and
   `p_new_method in ('points','credit')` and `p_new_method = v_orig.method`.
5. If `v_orig.method = 'cash'` → `app.require_role('owner','manager')`.
6. Resolve the booked session: `p_session_id` if given and `open`, else the open
   session for the original payment's device (the `reverse_payment` join). Null →
   `raise 'the till this was paid on is closed — an owner can still correct it'`.
7. Validate the new method's reference / tender rules (from `record_payment`).
8. Insert the negative mirror (method `= v_orig.method`, amount `= -v_orig.amount`,
   `external_ref = v_orig.external_ref`, `reverses_payment_id = v_orig.id`,
   `cash_session_id = v_orig.cash_session_id`, `booked_session_id = v_session`).
9. Insert the new payment (method `= p_new_method`, amount `= v_orig.amount`,
   tender/change per rules, `external_ref = p_new_external_ref`,
   `cash_session_id = v_session`, `booked_session_id = v_session`).
10. Lock the invoice `for update`, recompute `amount_paid = sum(amount)` and
    `status` (`paid` / `partly_paid` / `issued`).
11. `payment_method_changed` audit event.
12. Store the idempotency key → `{payment_id: <new row id>}`. Return the new row.

`revoke execute … from public; grant execute … to authenticated;` — like the
other money RPCs.

### DB verify script

`scripts/_verify-change-payment-method.mjs` — sandbox tenant, `BEGIN` / `ROLLBACK`
(the `_verify-cheque.mjs` template). Assertions:

- Card → Juice on a paid invoice: invoice stays `paid`, `amount_paid` unchanged;
  three payment rows (card, −card, juice); Juice row has the new ref.
- Points earned on the invoice are **unchanged** (no unwind / re-award).
- A job delivered by the original payment stays `delivered` with its **original**
  `delivered_at`.
- Card → Juice with **no reference** → refused.
- New method == old method → refused.
- `points` / `credit` on either side → refused.
- Original session closed, no open sibling → refused.
- `cash` → `card` as a `cashier` role → refused; as `manager` → allowed.
- `card` → `cash` as a `cashier` → allowed, tender defaults to exact.
- Same `idempotency_key` twice → one net change, same row returned.
- Partial payment (one of several rows) changed → only that row mirrored, others
  untouched.
- The post-issue money-column lock (`20260711000001_lock_document_money_columns`)
  permits this RPC's `documents` `amount_paid` / `status` update, exactly as it
  permits `reverse_payment`'s — confirm by probe, do not assume.

## Android

- **`PosApi.kt`** — `changePaymentMethod(paymentId, newMethod, newRef, sessionId,
  idempotencyKey)` calling `change_payment_method` (shape mirrors `recordPayment`
  / `reversePayment`).
- **`CounterViewModel.kt`** —
  - `TodayPaymentDto` already carries `method`; use it for the "from" label and
    to filter the method choices.
  - New UI state for a "change method" step inside the payment-action flow:
    chosen `PayMethod`, reference text, busy/error.
  - `changePaymentMethod(p: TodayPaymentDto, newMethod: PayMethod, ref: String)`
    via the existing `correction(...)` helper (clears the sheet, reloads lists,
    shows a notice). Passes `local.value.till?.id` as `sessionId` and a fresh
    idempotency key.
  - Cash carve-out mirrored client-side for the affordance (server still
    enforces): hide the "change method" section on a `cash`-source row unless
    `canManage`. Targets: offer every method except `points` and the current
    one — including `cash` — and let the server make the final call.
- **`CounterScreen.kt`** —
  - `PaymentActionDialog` (“Correct this payment”): add a **Change payment
    method** section — a row of method chips (Cash / Card / Juice / Bank /
    Cheque, minus the current one) + a reference field (hidden for cash; optional
    for cheque) + a Confirm button. Visible to **all** roles; the existing
    Reverse / Refund actions stay `canManage`-only.
  - The PAID TODAY list row is currently `clickable(enabled = vm.canManage)`
    (line ~836) — drop the `enabled` gate so a cashier can open the sheet. The
    sheet itself shows only what each role may do.
  - Post-sale panel (`SaleDone`, line ~486): add a **Wrong method?** control that
    opens the same change-method step for the just-recorded payment(s). For a
    split, list the rows and change one at a time.
- **Receipt** — after the change, rebuild the slip from the server invoice (the
  existing `saleReceiptDoc` path) and reprint, so the paper shows the corrected
  method. Web ↔ tablet ↔ SQL held to one fixture per the parity rule.

## Web

- **`apps/web/src/features/jobs/actions.ts`** — `changePaymentMethodAction(jobId,
  invoiceId, paymentId, newMethod, newRef, token)` → new `rpc.changePaymentMethod`.
- **`apps/web/src/lib/supabase/rpc`** — add `changePaymentMethod`.
- **`apps/web/src/app/(app)/sales/[id]/page.tsx`** — this page already lists
  `doc.payments` with a per-row owner-only “Reverse this payment” `<details>`
  (line ~505). Add a sibling **“Change method”** `<details>` on each live,
  non-`points`/`credit` row: a `<select>` of the other methods + a reference
  input + Confirm, posting to a `changePaymentMethodAction` server action
  (`requireRole` allows `cashier` too; `cash`-source rows keep the owner/manager
  floor). Reuse `METHOD_LABEL`.
- **`apps/web/src/features/jobs/JobCard.tsx`** — the job page shows the bill but
  has no recorded-payment list. Add a compact recorded-payments list with the
  same “Change method” control, so a counter correction is reachable from the job
  the car is on, not only the sales document.
- **`apps/web/src/features/documents/RecordPaymentForm`** and
  `apps/web/src/features/counter/CounterSale.tsx` post-sale state — out of scope
  for v1 unless trivial; the sales-document + job-card controls cover the flow.

## Out of scope

- Changing the **amount** (existing reverse + re-collect).
- Any card-terminal integration / automatic decline detection.
- Splitting one payment into several during the change (change targets one row).
- A clearing lifecycle for the new method.

## Parity

Both platforms call `change_payment_method` with the same arguments and the same
guard semantics. One shared DB fixture drives the web test, the Android test and
`_verify-change-payment-method.mjs`. Receipt output (tablet slip ↔ web
`ReceiptCard`) reflects the corrected method identically.
