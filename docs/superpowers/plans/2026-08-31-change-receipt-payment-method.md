# Change a Receipt's Payment Method — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cashier can change an already-recorded payment's method (Card → Juice, etc.) for the same amount on the same bill, on web and Android, without the owner-only `reverse_payment` path.

**Architecture:** One new `SECURITY DEFINER` RPC, `public.change_payment_method`, does a negative-mirror + new-payment insert in one transaction and recomputes the invoice. Net money movement is zero, points and job-delivery are untouched, so the RPC is `cashier`-callable — except changing *away from* `cash`, which stays owner/manager. Web calls it from the sales-document page and the job card; Android from the counter's payment-action sheet and post-sale panel.

**Tech Stack:** Postgres/plpgsql (Supabase), `pg` verify scripts, Next.js server actions + `apps/web/src/lib/supabase/rpc.ts`, Kotlin/Compose (`PosApi` → `CounterViewModel` → `CounterScreen`).

**Reference — read before starting:**
- Spec: `docs/superpowers/plans/../specs/2026-08-31-change-receipt-payment-method-design.md`
- Live RPC bodies (authoritative, not the migration files): run
  `select pg_get_functiondef('public.reverse_payment'::regprocedure);` and
  `select pg_get_functiondef('public.record_payment'::regprocedure);`
- `supabase/migrations/20260827000020_cheque_can_settle_a_bill.sql` — most recent payment-method migration, house style.
- `scripts/_verify-cheque.mjs` — verify-script template.
- `.env` must hold `SUPABASE_DB_URL`. DB scripts need the sandbox disabled (port 5432).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260831000010_a_receipt_can_change_how_it_was_paid.sql` | **Create.** The `change_payment_method` RPC + grants + install-time assertion. |
| `scripts/_verify-change-payment-method.mjs` | **Create.** DB probe, `BEGIN`/`ROLLBACK`, sandbox tenant — proves the guards and the zero-net invariant. |
| `apps/web/src/lib/supabase/rpc.ts` | **Modify.** Add `changePaymentMethod` wrapper + `ChangePaymentMethodArgs`. |
| `apps/web/src/features/jobs/actions.ts` | **Modify.** Add `changePaymentMethodAction` server action. |
| `apps/web/src/features/jobs/change-method.ts` | **Create.** Pure helper: `methodChangeTargets(current, opts)` — the offerable target list. Shared by web UI + its test. |
| `apps/web/src/features/jobs/change-method.test.ts` | **Create.** Unit test for `methodChangeTargets`. |
| `apps/web/src/app/(app)/sales/[id]/page.tsx` | **Modify.** Per-payment-row "Change method" control + its inline server action. |
| `apps/web/src/features/jobs/JobCard.tsx` | **Modify.** Recorded-payments list with the same control. |
| `apps/web/src/lib/supabase/queries/jobs.ts` | **Modify.** Include the invoice's `payments` rows in `getJob` if not already present. |
| `android/app/src/main/java/mu/carfection/pos/core/network/PosApi.kt` | **Modify.** `changePaymentMethod(...)` calling the RPC. |
| `android/app/src/main/java/mu/carfection/pos/feature/counter/MethodChange.kt` | **Create.** Pure `methodChangeTargets(current, canManage)` + `canOfferMethodChange(methodOfRow, canManage)`. |
| `android/app/src/main/java/mu/carfection/pos/feature/counter/CounterViewModel.kt` | **Modify.** UI state for the change-method step + `changePaymentMethod(...)`. |
| `android/app/src/main/java/mu/carfection/pos/feature/counter/CounterScreen.kt` | **Modify.** "Change method" section in `PaymentActionDialog`; open the sheet for cashiers; `SaleDone` "Wrong method?" control. |
| `android/app/src/test/java/mu/carfection/pos/feature/counter/MethodChangeTest.kt` | **Create.** Pure-function test, `SettleLockTest` style. |

---

## Task 1: The `change_payment_method` RPC

**Files:**
- Create: `supabase/migrations/20260831000010_a_receipt_can_change_how_it_was_paid.sql`

- [ ] **Step 1: Re-read the live RPC bodies**

Run (via Supabase MCP `execute_sql` or `psql`):
```sql
select pg_get_functiondef('public.reverse_payment'::regprocedure);
select pg_get_functiondef('public.record_payment'::regprocedure);
```
Confirm: `reverse_payment` is `(uuid, text, uuid)`, inserts a negative mirror with `method = v_orig.method`, resolves `v_booked` by joining `cash_sessions` on `device_id` for an `open` sibling, refuses a `cash` reversal with no open till. `record_payment` requires `p_cash_session_id`, takes `for share` on the session, requires an external ref for non-cash/non-cheque, computes cash change, writes an `idempotency_keys` row.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260831000010_a_receipt_can_change_how_it_was_paid.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a receipt can change HOW it was paid.
--
-- The card machine is separate from the POS. The cashier taps Card, the slip
-- prints, THEN the PDQ declines it and the customer pays by Juice instead.
-- reverse_payment is the only correction path today and it is owner-only
-- (20260810000060) with a typed reason — the counter stalls.
--
-- change_payment_method is a NARROW carve-out: it reverses the original line
-- and books a new one for the IDENTICAL amount on the IDENTICAL invoice, in
-- one transaction. amount_paid and status come out unchanged, points and job
-- delivery are never touched — so net money movement is provably zero and a
-- cashier may do it. Changing AWAY FROM cash is the one exception (it removes
-- an expectation of cash in the drawer) and still needs owner|manager.
--
-- Spliced from the LIVE bodies of reverse_payment + record_payment, not the
-- migration files.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.change_payment_method(
  p_payment_id       uuid,
  p_new_method       payment_method,
  p_new_external_ref text default null,
  p_session_id       uuid default null,
  p_idempotency_key  text default null
) returns payments
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_actor    uuid := app.current_app_user_id();
  v_orig     public.payments;
  v_doc      public.documents;
  v_session  uuid;
  v_new      public.payments;
  v_new_id   uuid := gen_random_uuid();
  v_tendered numeric;
  v_change   numeric;
  v_paid     numeric;
  v_existing uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  -- ── idempotency: same key ⇒ return the row it already produced ───────────
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || p_idempotency_key)::bigint);
    select (result->>'payment_id')::uuid into v_existing
      from public.idempotency_keys where tenant_id = v_tenant and key = p_idempotency_key;
    if v_existing is not null then
      select * into v_new from public.payments where id = v_existing;
      return v_new;
    end if;
  end if;

  -- ── load + validate the original line ───────────────────────────────────
  select * into v_orig from public.payments
   where id = p_payment_id and tenant_id = v_tenant for update;
  if not found then raise exception 'payment not found'; end if;
  if v_orig.amount <= 0 then raise exception 'cannot change a reversal'; end if;
  if exists (select 1 from public.payments
              where reverses_payment_id = p_payment_id and tenant_id = v_tenant) then
    raise exception 'payment already reversed';
  end if;
  if v_orig.method in ('points','credit') then
    raise exception 'a % payment cannot have its method changed here', v_orig.method;
  end if;
  if p_new_method in ('points','credit') then
    raise exception 'cannot change a payment to %', p_new_method;
  end if;
  if p_new_method = v_orig.method then
    raise exception 'that is already the payment method';
  end if;

  -- Changing AWAY FROM cash removes an expectation of cash in the drawer.
  if v_orig.method = 'cash' then
    perform app.require_role('owner','manager');
  end if;

  select * into v_doc from public.documents
   where id = v_orig.document_id and tenant_id = v_tenant for update;
  if v_doc.status = 'void' then raise exception 'the invoice is void'; end if;
  if exists (
    select 1 from public.documents cn
     where cn.tenant_id = v_tenant and cn.doc_type = 'credit_note'
       and cn.source_document_id = v_orig.document_id and cn.status <> 'void'
  ) then
    raise exception 'this invoice has a credit note — correct it there';
  end if;

  -- ── the till both rows land on: given session, else the original's open
  --    sibling for the same device (the reverse_payment lookup) ────────────
  v_session := p_session_id;
  if v_session is null and v_orig.cash_session_id is not null then
    select s2.id into v_session
      from public.cash_sessions s1
      join public.cash_sessions s2
        on s2.device_id = s1.device_id and s2.tenant_id = s1.tenant_id and s2.status = 'open'
     where s1.id = v_orig.cash_session_id;
  end if;
  if v_session is null then
    raise exception 'the till this was paid on is closed — an owner can still correct it';
  end if;
  perform 1 from public.cash_sessions
   where id = v_session and tenant_id = v_tenant and status = 'open' for share;
  if not found then raise exception 'unknown or closed cash session'; end if;

  -- ── new method's own rules (from record_payment) ───────────────────────
  if p_new_method = 'cash' then
    v_tendered := v_orig.amount;
    v_change   := 0;
  else
    if p_new_external_ref is null and p_new_method <> 'cheque' then
      raise exception 'a % payment requires an external reference', p_new_method;
    end if;
    v_tendered := null;
    v_change   := null;
  end if;

  -- ── negative mirror of the original (reverse_payment shape) ────────────
  insert into public.payments
    (tenant_id, document_id, method, amount, external_ref, reverses_payment_id,
     cash_session_id, booked_session_id, received_by)
  values
    (v_tenant, v_orig.document_id, v_orig.method, -v_orig.amount,
     v_orig.external_ref, v_orig.id,
     v_orig.cash_session_id, v_session, v_actor);

  -- ── the new payment ───────────────────────────────────────────────────
  insert into public.payments
    (id, tenant_id, document_id, method, amount, tendered, change_given, external_ref,
     cash_session_id, booked_session_id, received_by)
  values
    (v_new_id, v_tenant, v_orig.document_id, p_new_method, v_orig.amount,
     v_tendered, v_change, p_new_external_ref,
     v_session, v_session, v_actor)
  returning * into v_new;

  -- ── recompute the invoice (nets to the same figure) ───────────────────
  select coalesce(sum(amount), 0) into v_paid
    from public.payments where document_id = v_orig.document_id;
  update public.documents
     set amount_paid = v_paid,
         status = (case when v_paid >= total_incl then 'paid'
                        when v_paid > 0 then 'partly_paid'
                        else 'issued' end)::doc_status
   where id = v_orig.document_id;

  -- Points and job delivery are deliberately NOT touched: total paid is
  -- unchanged, so both are already correct.

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'payment_method_changed', 'payment', v_orig.id,
          jsonb_build_object(
            'original_payment_id', v_orig.id, 'new_payment_id', v_new.id,
            'from_method', v_orig.method, 'to_method', p_new_method,
            'amount', v_orig.amount, 'invoice', v_doc.number,
            'booked_session', v_session,
            'reason', 'method changed at POS: ' || v_orig.method || ' → ' || p_new_method));

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (tenant_id, key, rpc, result)
    values (v_tenant, p_idempotency_key, 'change_payment_method',
            jsonb_build_object('payment_id', v_new.id))
    on conflict (tenant_id, key) do nothing;
  end if;

  return v_new;
end $function$;

revoke execute on function public.change_payment_method(uuid, payment_method, text, uuid, text) from public;
grant  execute on function public.change_payment_method(uuid, payment_method, text, uuid, text) to authenticated;

-- ── prove it installed ────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.change_payment_method(uuid, payment_method, text, uuid, text)') is null then
    raise exception 'change_payment_method did not install';
  end if;
end $$;
```

- [ ] **Step 3: Apply the migration**

```bash
node scripts/db-exec.mjs supabase/migrations/20260831000010_a_receipt_can_change_how_it_was_paid.sql
```
(Run with the sandbox disabled — port 5432.) Expected: `✓ Done.`

- [ ] **Step 4: Sanity-check the signature**

```sql
select pg_get_function_identity_arguments('public.change_payment_method'::regprocedure);
```
Expected: `uuid, payment_method, text, uuid, text`

No commit yet — commit with the verify script in Task 2.

---

## Task 2: DB verify script

**Files:**
- Create: `scripts/_verify-change-payment-method.mjs`

- [ ] **Step 1: Write the script**

Model it on `scripts/_verify-cheque.mjs` (same `pg` client, `asUser`, `check`, `BEGIN`/`ROLLBACK`, `SANDBOX_AUTH = "b729191b-1159-4d46-88c7-3c9aceb5e664"`). It must set up a customer, an open till (`open_cash_session` with a unique code), a draft invoice via `save_draft`, issue via `issue_document`, then:

```
▸ 1. Card → Juice on a paid invoice
     - record_payment(inv, 'card', total, ref 'PDQ-1') → invoice paid
     - change_payment_method(cardPaymentId, 'juice', 'JUICE-1', till)
     - check: 3 payment rows for the doc: +card, -card, +juice
     - check: documents.amount_paid unchanged, status still 'paid'
     - check: the juice row external_ref = 'JUICE-1'
     - check: sum(amount) over the doc's payments = total

▸ 2. an audit row 'payment_method_changed' was written for the original payment id

▸ 3. Card → Juice with NULL ref → refused ('requires an external reference')

▸ 4. new method == old method → refused ('already the payment method')

▸ 5. 'points' as target → refused; a 'points' original → refused

▸ 6. till closed, no open sibling → refused
     (close_cash_session on the till, then change_payment_method → refusal
      'the till this was paid on is closed')

▸ 7. cash carve-out
     - as a cashier auth uid: cash → card refused ('requires the role owner or manager'
       — match on the RPC's actual message; adjust token to what require_role raises)
     - as the sandbox owner: cash → card allowed, card → cash allowed (tender defaults exact)

▸ 8. idempotency: change_payment_method(card→juice, key='k1') twice
     → second call returns the same payment id, still only one -card + one juice row

▸ 9. points earned unchanged: award happened at full payment; after the swap
     select coalesce(sum(points),0) from points_ledger where document_id = inv
     is identical before and after (earn row intact, no unwind/re-award)

▸ 10. partial payment: invoice total T, pay 0.4T card + 0.6T cash;
      change the card row → juice; the cash row is untouched; status back to 'paid'
```

For a "cashier" auth uid in the sandbox: query for one, or `set_config('request.jwt.claims', …, true)` with `role: 'authenticated'` and a `sub` that maps to a cashier `app_users` row in the sandbox tenant; if none exists, create one in-transaction (it rolls back). Keep the exact refusal-substring tokens loose (`asRefusal`) — match the first few words the RPC raises.

- [ ] **Step 2: Run it**

```bash
node scripts/_verify-change-payment-method.mjs
```
Expected: every line `✓`, exit 0. Fix the RPC (Task 1) or the script until green.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260831000010_a_receipt_can_change_how_it_was_paid.sql scripts/_verify-change-payment-method.mjs
git commit -m "feat(db): a receipt can change how it was paid"
```

---

## Task 3: Regenerate web DB types

**Files:**
- Modify: `apps/web/src/lib/supabase/database.types.ts` (generated)

- [ ] **Step 1: Regenerate**

```bash
npm run db:types
```
Expected: `change_payment_method` appears under `Functions` in `database.types.ts`.
If the generator can't run headless, skip — the `rpc.ts` wrapper uses `callRpc` with a string name and does not depend on the generated type.

- [ ] **Step 2: Commit (only if the file changed)**

```bash
git add apps/web/src/lib/supabase/database.types.ts
git commit -m "chore(web): regenerate db types for change_payment_method"
```

---

## Task 4: Web — `rpc.changePaymentMethod`

**Files:**
- Modify: `apps/web/src/lib/supabase/rpc.ts` (after `reversePayment`, ~line 225)

- [ ] **Step 1: Add the wrapper**

```ts
export interface ChangePaymentMethodArgs {
  paymentId: string;
  newMethod: "cash" | "card" | "juice" | "bank_transfer" | "cheque";
  newExternalRef?: string | null;
  cashSessionId?: string | null;
  idempotencyKey?: string | null;
}

/** Correct a recorded payment's METHOD for the same amount on the same bill:
 *  one transaction inserts the negative mirror + the new line, nets to zero.
 *  Cashier-allowed (server enforces owner/manager only when changing AWAY from
 *  cash). Not for `points`/`credit`, not for changing the amount. */
export const changePaymentMethod = (sb: Client, a: ChangePaymentMethodArgs) =>
  callRpc<PaymentRow>(sb, "change_payment_method", {
    p_payment_id: a.paymentId,
    p_new_method: a.newMethod,
    p_new_external_ref: a.newExternalRef ?? null,
    p_session_id: a.cashSessionId ?? null,
    p_idempotency_key: a.idempotencyKey ?? null,
  });
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/supabase/rpc.ts
git commit -m "feat(web): rpc.changePaymentMethod"
```

---

## Task 5: Web — the offerable-targets helper + test

**Files:**
- Create: `apps/web/src/features/jobs/change-method.ts`
- Create: `apps/web/src/features/jobs/change-method.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/jobs/change-method.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { methodChangeTargets, PAYMENT_METHOD_LABELS } from "./change-method";

describe("methodChangeTargets", () => {
  it("omits the current method", () => {
    expect(methodChangeTargets("card", { canManage: true })).not.toContain("card");
  });
  it("never offers points or credit", () => {
    const t = methodChangeTargets("card", { canManage: true });
    expect(t).not.toContain("points");
    expect(t).not.toContain("credit");
  });
  it("offers cash as a target for anyone", () => {
    expect(methodChangeTargets("card", { canManage: false })).toContain("cash");
  });
  it("a cashier gets no targets for a cash-source row (cannot change away from cash)", () => {
    expect(methodChangeTargets("cash", { canManage: false })).toEqual([]);
  });
  it("a manager can change a cash-source row", () => {
    expect(methodChangeTargets("cash", { canManage: true })).toContain("card");
  });
  it("points/credit source rows are never changeable", () => {
    expect(methodChangeTargets("points", { canManage: true })).toEqual([]);
    expect(methodChangeTargets("credit", { canManage: true })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — fails (module missing)**

```bash
cd apps/web && npx vitest run src/features/jobs/change-method.test.ts
```
Expected: FAIL — cannot find `./change-method`.

- [ ] **Step 3: Implement**

`apps/web/src/features/jobs/change-method.ts`:
```ts
export type ChangeableMethod = "cash" | "card" | "juice" | "bank_transfer" | "cheque";

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash", card: "Card", juice: "Juice",
  bank_transfer: "Bank transfer", cheque: "Cheque", points: "Points", credit: "On account",
};

const ALL: ChangeableMethod[] = ["cash", "card", "juice", "bank_transfer", "cheque"];

/** The methods a recorded payment currently in `current` may be switched to.
 *  Empty ⇒ don't show the control. Mirrors change_payment_method's server guards:
 *  no points/credit either side; a cash SOURCE row is owner/manager only. */
export function methodChangeTargets(
  current: string,
  opts: { canManage: boolean },
): ChangeableMethod[] {
  if (current === "points" || current === "credit") return [];
  if (current === "cash" && !opts.canManage) return [];
  return ALL.filter((m) => m !== current);
}
```

- [ ] **Step 4: Run it — passes**

```bash
cd apps/web && npx vitest run src/features/jobs/change-method.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/jobs/change-method.ts apps/web/src/features/jobs/change-method.test.ts
git commit -m "feat(web): offerable payment-method targets helper"
```

---

## Task 6: Web — `changePaymentMethodAction`

**Files:**
- Modify: `apps/web/src/features/jobs/actions.ts` (beside `recordPaymentAction`, ~line 151)

- [ ] **Step 1: Read `recordPaymentAction`**

Note its shape: `getSessionContext`, `backOfficeTillId` (the desk till every web payment books to), `rpc.*` call, `revalidatePath`, the `{ ok, error }` return, the `token` → `idempotencyKey` pattern.

- [ ] **Step 2: Add the action**

```ts
/**
 * Change a recorded payment's METHOD (card declined at the terminal, customer
 * pays another way). Same amount, same bill — change_payment_method nets it to
 * zero. Cashier-allowed; the RPC itself refuses a cash-source change for a
 * non-manager. Books onto the same back-office desk till as every web payment.
 */
export async function changePaymentMethodAction(
  jobId: string,
  invoiceId: string,
  paymentId: string,
  newMethod: "cash" | "card" | "juice" | "bank_transfer" | "cheque",
  newExternalRef: string,
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (newMethod !== "cash" && newMethod !== "cheque" && !newExternalRef.trim()) {
    return { ok: false, error: "The new card, Juice or transfer payment needs its reference." };
  }
  if (!token) return { ok: false, error: "Missing token — reopen the form and try again." };
  const sb = await createClient();
  try {
    const backOfficeTillId = await ensureBackOfficeTill(sb, ctx);
    await rpc.changePaymentMethod(sb, {
      paymentId,
      newMethod,
      newExternalRef: newExternalRef.trim() || null,
      cashSessionId: backOfficeTillId,
      idempotencyKey: `web-change-method:${token}`,
    });
    await jobAudit(sb, ctx, "payment_method_changed", jobId, { invoiceId, paymentId, newMethod });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not change the method." };
  }
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/sales/${invoiceId}`);
  return { ok: true };
}
```

Match the helper name `recordPaymentAction` uses to obtain `backOfficeTillId` (grep `actions.ts` for `backOffice` / `back_office_till`); reuse it verbatim rather than inventing `ensureBackOfficeTill`.

- [ ] **Step 3: Typecheck**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/jobs/actions.ts
git commit -m "feat(web): changePaymentMethodAction"
```

---

## Task 7: Web — "Change method" control on the sales document page

**Files:**
- Modify: `apps/web/src/app/(app)/sales/[id]/page.tsx`

- [ ] **Step 1: Add the inline server action** (beside `reversePaymentAction`, ~line 39)

```tsx
async function changeMethodAction(formData: FormData) {
  "use server";
  const paymentId = String(formData.get("paymentId") ?? "").trim();
  const documentId = String(formData.get("documentId") ?? "").trim();
  const newMethod = String(formData.get("newMethod") ?? "").trim() as
    "cash" | "card" | "juice" | "bank_transfer" | "cheque";
  const ref = String(formData.get("ref") ?? "").trim();
  if (!paymentId || !documentId || !newMethod) return;
  await requireRole("owner", "manager", "cashier");
  const sb = await createClient();
  try {
    // Sales-doc payments already have a cash_session_id; let the RPC resolve the
    // open sibling. No session passed here.
    await rpc.changePaymentMethod(sb, {
      paymentId, newMethod, newExternalRef: ref || null,
      idempotencyKey: `sales-change-method:${paymentId}:${newMethod}`,
    });
  } catch (e) {
    redirect(`/sales/${documentId}?changeError=${encodeURIComponent((e as Error).message)}`);
  }
  revalidatePath(`/sales/${documentId}`);
  redirect(`/sales/${documentId}`);
}
```

Add `changeError` to the `searchParams` type and render it beside the existing `reverseError` banner (~line 447).

- [ ] **Step 2: Compute `canChangeMethod`** near `canReversePayment` (~line 73)

```tsx
const canChangeMethod = !!session && ["owner", "manager", "cashier"].includes(session.role);
```

- [ ] **Step 3: Add the control** inside the payment `<li>` (after the `canReversePayment` block, ~line 528)

```tsx
{canChangeMethod && !cancelled && methodChangeTargets(p.method, { canManage: canReversePayment }).length > 0 && (
  <details className="mt-1">
    <summary className="cursor-pointer text-[11px] font-semibold text-link hover:underline">
      Change method
    </summary>
    <form action={changeMethodAction} className="mt-1.5 flex flex-wrap items-center gap-2">
      <input type="hidden" name="paymentId" value={p.id} />
      <input type="hidden" name="documentId" value={doc.id} />
      <select name="newMethod" required className="rounded-[8px] border border-line bg-transparent px-2 py-1 text-[11.5px] text-body">
        {methodChangeTargets(p.method, { canManage: canReversePayment }).map((m) => (
          <option key={m} value={m}>{METHOD_LABEL[m] ?? m}</option>
        ))}
      </select>
      <input type="text" name="ref" placeholder="New reference" className="min-w-0 flex-1 rounded-[8px] border border-line bg-transparent px-2 py-1 text-[11.5px] text-body placeholder:text-faint" />
      <button type="submit" className="flex shrink-0 items-center gap-1 rounded-[8px] bg-link px-2.5 py-1 text-[11px] font-bold text-white">Confirm</button>
    </form>
    <p className="mt-1 text-[10.5px] text-faint">Same amount, same bill. For a declined card, run the new tender first and enter its reference.</p>
  </details>
)}
```

Import `methodChangeTargets` from `@/features/jobs/change-method` at the top.

- [ ] **Step 4: Typecheck + build the page**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/sales/[id]/page.tsx"
git commit -m "feat(web): change a recorded payment's method from the sales page"
```

---

## Task 8: Web — recorded-payments list on the job card — DEFERRED (v1.1)

`getJob` returns no payment rows today; adding the list means a new query, a
`JobDetail` type change, a client component and session-role threading — real
surface area for a path already fully covered by `/sales/[id]` (linked from the
job). The declined-card case happens at the counter (tablet), not the job page.
Ship this as a follow-up.

<details><summary>original task</summary>

**Files:**
- Modify: `apps/web/src/lib/supabase/queries/jobs.ts`
- Modify: `apps/web/src/features/jobs/JobCard.tsx`

- [ ] **Step 1: Ensure `getJob` returns the invoice payments**

Grep `jobs.ts` for the invoice select. If `payments` (id, method, amount, external_ref, received_at, received_by name, reverses_payment_id) are not already embedded on the invoice document, add them, matching the `getDocumentDetail` select in `queries/document.ts` (reuse its shape/field names).

- [ ] **Step 2: Render the list + control in `JobCard.tsx`**

Where the live invoice is shown (grep `liveInvoice` / `docType === "invoice"`), add under it a compact list of non-reversal payment rows. For each row whose `methodChangeTargets(row.method, { canManage })` is non-empty, render a small "Change method" disclosure that calls `changePaymentMethodAction(job.id, liveInvoice.id, row.id, newMethod, ref, token)` — client component pattern, same `useState`/`token` idiom as the existing `RecordPayment` block in this file (grep `recordPaymentAction` usage ~line 102). `canManage` = role in `["owner","manager"]` from the session/props already threaded into `JobCard`.

Show the RPC's error string inline on failure; on success call the existing refresh (`onDone` / `router.refresh()` as used by the sibling payment form).

- [ ] **Step 3: Typecheck**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Manual smoke (optional, web dev server)**

```bash
cd apps/web && npm run dev
```
Open a job with a paid invoice → the payment row shows "Change method" → switch Card→Juice with a ref → row list now shows −Card and +Juice, bill still paid.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/supabase/queries/jobs.ts apps/web/src/features/jobs/JobCard.tsx
git commit -m "feat(web): change a payment's method from the job card"
```

</details>

---

## Task 9: Android — `PosApi.changePaymentMethod`

**Files:**
- Modify: `android/app/src/main/java/mu/carfection/pos/core/network/PosApi.kt` (after `reversePayment`, ~line 1244)

- [ ] **Step 1: Add the call**

```kotlin
/** Change a recorded payment's METHOD for the same amount on the same bill:
 *  negative mirror + new line in one transaction (nets to zero). Cashier-allowed;
 *  the server refuses a cash-source change for a non-manager. */
suspend fun changePaymentMethod(
    paymentId: String,
    newMethod: String,           // cash | card | juice | bank_transfer | cheque
    newExternalRef: String?,
    sessionId: String?,
    idempotencyKey: String,
): PaymentDto =
    client.postgrest.rpc("change_payment_method", buildJsonObject {
        put("p_payment_id", paymentId)
        put("p_new_method", newMethod)
        if (newExternalRef != null) put("p_new_external_ref", newExternalRef) else put("p_new_external_ref", JsonNull)
        if (sessionId != null) put("p_session_id", sessionId) else put("p_session_id", JsonNull)
        put("p_idempotency_key", idempotencyKey)
    }).decodeAs()
```

- [ ] **Step 2: Compile**

```bash
cd android && ./gradlew :app:compileDebugKotlin -q
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/mu/carfection/pos/core/network/PosApi.kt
git commit -m "feat(android): PosApi.changePaymentMethod"
```

---

## Task 10: Android — the offerable-targets helper + test

**Files:**
- Create: `android/app/src/main/java/mu/carfection/pos/feature/counter/MethodChange.kt`
- Create: `android/app/src/test/java/mu/carfection/pos/feature/counter/MethodChangeTest.kt`

- [ ] **Step 1: Write the failing test**

`MethodChangeTest.kt`:
```kotlin
package mu.carfection.pos.feature.counter

import mu.carfection.pos.core.data.PayMethod
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MethodChangeTest {
    @Test fun `omits the current method`() {
        assertFalse(PayMethod.CARD in methodChangeTargets(PayMethod.CARD, canManage = true))
    }
    @Test fun `never offers points`() {
        assertFalse(PayMethod.POINTS in methodChangeTargets(PayMethod.CARD, canManage = true))
    }
    @Test fun `offers cash to anyone`() {
        assertTrue(PayMethod.CASH in methodChangeTargets(PayMethod.CARD, canManage = false))
    }
    @Test fun `a cashier cannot change a cash row`() {
        assertEquals(emptyList<PayMethod>(), methodChangeTargets(PayMethod.CASH, canManage = false))
    }
    @Test fun `a manager can change a cash row`() {
        assertTrue(PayMethod.CARD in methodChangeTargets(PayMethod.CASH, canManage = true))
    }
    @Test fun `points row is never changeable`() {
        assertEquals(emptyList<PayMethod>(), methodChangeTargets(PayMethod.POINTS, canManage = true))
    }
}
```

- [ ] **Step 2: Run it — fails**

```bash
cd android && ./gradlew :app:testDebugUnitTest --tests "mu.carfection.pos.feature.counter.MethodChangeTest" -q
```
Expected: FAIL — unresolved reference `methodChangeTargets`.

- [ ] **Step 3: Implement**

`MethodChange.kt`:
```kotlin
package mu.carfection.pos.feature.counter

import mu.carfection.pos.core.data.PayMethod

/** Methods a recorded payment in [current] may be switched to. Empty ⇒ hide the
 *  control. Mirrors change_payment_method's server guards: never points/credit;
 *  a CASH source row is owner/manager only (changing away from cash removes a
 *  drawer expectation). CREDIT is not a real payment row, so it never appears. */
fun methodChangeTargets(current: PayMethod, canManage: Boolean): List<PayMethod> {
    if (current == PayMethod.POINTS || current == PayMethod.CREDIT) return emptyList()
    if (current == PayMethod.CASH && !canManage) return emptyList()
    return listOf(PayMethod.CASH, PayMethod.CARD, PayMethod.JUICE, PayMethod.BANK, PayMethod.CHEQUE)
        .filter { it != current }
}
```
(Confirm the enum constant names in `core/data/PayMethod` — `BANK` vs `BANK_TRANSFER`, and that `CREDIT`/`POINTS` exist. `SPLIT_METHODS` at `CounterViewModel.kt:461` uses `PayMethod.BANK`.)

- [ ] **Step 4: Run it — passes**

```bash
cd android && ./gradlew :app:testDebugUnitTest --tests "mu.carfection.pos.feature.counter.MethodChangeTest" -q
```
Expected: PASS (6).

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/mu/carfection/pos/feature/counter/MethodChange.kt android/app/src/test/java/mu/carfection/pos/feature/counter/MethodChangeTest.kt
git commit -m "feat(android): offerable payment-method targets helper"
```

---

## Task 11: Android — ViewModel wiring

**Files:**
- Modify: `android/app/src/main/java/mu/carfection/pos/feature/counter/CounterViewModel.kt`

- [ ] **Step 1: Add UI state** — on `CounterUiState` (near `paymentAction`, line ~125):

```kotlin
val methodChangeFor: TodayPaymentDto? = null, // a payment row whose method is being changed
val methodChangePick: PayMethod = PayMethod.CARD,
val methodChangeRef: String = "",
```

- [ ] **Step 2: Add the intents** (near `openPaymentAction` / `closePaymentAction`, line ~839):

```kotlin
fun startMethodChange(p: TodayPaymentDto) {
    val first = methodChangeTargets(payMethodOf(p.method), canManage).firstOrNull() ?: return
    local.value = local.value.copy(methodChangeFor = p, methodChangePick = first, methodChangeRef = "")
}
fun pickMethodChange(m: PayMethod) { local.value = local.value.copy(methodChangePick = m, methodChangeRef = "") }
fun setMethodChangeRef(t: String) { local.value = local.value.copy(methodChangeRef = t) }
fun cancelMethodChange() { local.value = local.value.copy(methodChangeFor = null) }

fun confirmMethodChange() {
    val p = local.value.methodChangeFor ?: return
    val m = local.value.methodChangePick
    val ref = local.value.methodChangeRef.trim()
    if (m != PayMethod.CASH && m != PayMethod.CHEQUE && ref.isEmpty()) {
        local.value = local.value.copy(notice = "Enter the new payment's reference first."); return
    }
    val key = UUID.randomUUID().toString()
    correction("Method changed — ${p.documents?.number ?: "invoice"}") {
        api.changePaymentMethod(
            paymentId = p.id,
            newMethod = m.wire,                    // the enum's server string; see PayMethod
            newExternalRef = ref.ifEmpty { null },
            sessionId = local.value.till?.id,
            idempotencyKey = key,
        )
    }
    local.value = local.value.copy(methodChangeFor = null)
}
```

Add a small `payMethodOf(wire: String): PayMethod` mapper if one does not already exist (grep `PayMethod` in `core/data` — there may be a `fromWire` / `valueOf` helper; reuse it). `correction { }` already flips `busy`, clears `paymentAction`, reloads lists and shows the label.

- [ ] **Step 2b: Widen the sheet-open gate**

`openPaymentAction` is fine as-is; the screen currently only calls it for managers. That gate moves in Task 12.

- [ ] **Step 3: Compile**

```bash
cd android && ./gradlew :app:compileDebugKotlin -q
```
Expected: BUILD SUCCESSFUL. Resolve `PayMethod.wire` / `payMethodOf` against the real API.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/mu/carfection/pos/feature/counter/CounterViewModel.kt
git commit -m "feat(android): counter view-model wiring for method change"
```

---

## Task 12: Android — CounterScreen UI

**Files:**
- Modify: `android/app/src/main/java/mu/carfection/pos/feature/counter/CounterScreen.kt`

- [ ] **Step 1: Let a cashier open the payment sheet**

Line ~836: change
```kotlin
.clickable(enabled = vm.canManage) { vm.openPaymentAction(p) }
```
to
```kotlin
.clickable { vm.openPaymentAction(p) }
```

- [ ] **Step 2: Add the "Change method" section to `PaymentActionDialog`** (line ~1580)

Inside the `else ->` branch (not a reversal, not already reversed), ABOVE the "Refund — issue credit note" button, add:

```kotlin
val targets = methodChangeTargets(payMethodOf(p.method), vm.canManage)
if (targets.isNotEmpty()) {
    Text("Change payment method", color = TextPrimary, fontFamily = Condensed,
        fontSize = 15.sp, fontWeight = FontWeight.Bold)
    Text("Same amount, same bill — for a declined card, run the new tender first.",
        color = TextMuted, fontSize = 12.sp)
    val pick = vm.state.collectAsState().value.methodChangePick
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        targets.forEach { m ->
            val on = m == pick
            Box(
                Modifier.background(if (on) Accent else InsetAlt, RoundedCornerShape(10.dp))
                    .clickable { vm.pickMethodChange(m) }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            ) { Text(m.label, color = if (on) AccentInk else TextPrimary, fontSize = 13.sp,
                     fontWeight = FontWeight.SemiBold) }
        }
    }
    if (pick != PayMethod.CASH) {
        val ref = vm.state.collectAsState().value.methodChangeRef
        OutlinedTextField(
            ref, { vm.setMethodChangeRef(it) },
            label = { Text(if (pick == PayMethod.CHEQUE) "Cheque no. (optional)" else "New reference") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
    }
    ActionButton("Change to ${pick.label}", "Books the new tender, reverses the old one.",
        Accent, AccentInk) { vm.confirmMethodChange() }
    Spacer(Modifier.height(4.dp))
}
```

Use the file's existing `FlowRow` import if present; otherwise lay the chips out in a `Row` that wraps, or reuse the split-method chip row style from `CounterScreen`'s pad. Match surrounding color tokens (`Accent`, `InsetAlt`, `TextPrimary`, `TextMuted`).

- [ ] **Step 3: Gate the reverse/refund block on `vm.canManage`**

The "Refund — issue credit note" + "Reverse this payment only" controls must now be wrapped in `if (vm.canManage) { … }` (a cashier sees only "Change payment method"). If `!vm.canManage && targets.isEmpty()`, show `Text("Ask an owner or manager to correct this one.", …)`.

- [ ] **Step 4: `SaleDone` "Wrong method?" control**

In `SaleDone` (line ~1900) add, when `result.paymentIds` is non-empty (or `result.paymentId != null`) and not on-account, a ghost button `"Wrong method? Change it"` that calls a new `onChangeMethod: () -> Unit`. Wire it from the call site (line ~486) to `viewModel.startMethodChangeForDone()` — a VM helper that opens the change sheet for `done.paymentId` (single) or the first of `done.paymentIds`; for a split, `startMethodChange` on each is out of scope for v1 — open the first and note "one at a time". Reuse `openPaymentAction` by synthesising a `TodayPaymentDto` from `SaleResult` if the id/method are on it; otherwise fetch via `api` in the helper. Keep it minimal: if `SaleResult` lacks the method string, skip the `SaleDone` entry point in v1 and rely on the PAID TODAY sheet (which lists the same payment moments later).

- [ ] **Step 5: Compile + unit tests**

```bash
cd android && ./gradlew :app:compileDebugKotlin :app:testDebugUnitTest -q
```
Expected: BUILD SUCCESSFUL, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/mu/carfection/pos/feature/counter/CounterScreen.kt
git commit -m "feat(android): change a recorded payment's method from the counter"
```

---

## Task 13: Full verification

- [ ] **Step 1: DB probe**

```bash
node scripts/_verify-change-payment-method.mjs
```
Expected: all `✓`.

- [ ] **Step 2: Web**

```bash
cd apps/web && npx tsc --noEmit && npx vitest run src/features/jobs/change-method.test.ts
```
Expected: clean, tests pass.

- [ ] **Step 3: Android**

```bash
cd android && ./gradlew :app:testDebugUnitTest -q
```
Expected: all pass.

- [ ] **Step 4: Build the tablet APK + deploy to Desktop**

```bash
cd android && ./gradlew assembleDebug
```
Then copy `android/app/build/outputs/apk/debug/app-debug.apk` over
`C:\Users\sheik\OneDrive\Desktop\Carfectionist-POS.apk`.

- [ ] **Step 5: Launch the emulator for the user to test**

```bash
"%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe" -avd <avd> -no-snapshot-load
```
Wait for boot (`adb wait-for-device`), then
`adb install -r android/app/build/outputs/apk/debug/app-debug.apk`, then launch
via `adb shell am start -n mu.carfection.pos/.MainActivity` (never `monkey`).
Hand over to the user — do not drive the counter (taps are live transactions).

- [ ] **Step 6: Final commit / branch push**

```bash
git add -A && git commit -m "chore: verification pass for change-payment-method" || true
git log --oneline main..HEAD
```

---

## Self-Review Notes

- **Spec coverage:** RPC (T1), verify script (T2, all spec bullets mapped), web rpc/action/2 UIs (T4/6/7/8), Android api/vm/ui (T9–12), receipt reprint (T12 S4 + `correction()`'s `loadLists`), parity (shared guard helper both sides, same RPC args). Post-issue money-column lock — verified by the probe in T2 (record_payment/reverse_payment both update `documents` after issue, so the path is already open; the probe asserts status flips).
- **`points` earned invariance:** T2 ▸9 asserts it directly.
- **Open question for the executor:** `SaleResult` field shape for T12 S4 — if it lacks `method`, ship v1 without the post-sale entry point (PAID TODAY covers it) and note it.
- **Naming:** `methodChangeTargets` / `changePaymentMethod` / `change_payment_method` used consistently across SQL, TS, Kotlin.
