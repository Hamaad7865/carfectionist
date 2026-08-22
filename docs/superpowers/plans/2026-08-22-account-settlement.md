# Account Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer settle several open invoices in one action — pick invoices, optionally apply loyalty points, pay the rest in one method — from both the Contacts customer page and the Reports → Statement of accounts page.

**Architecture:** A pure allocation function (`planSettlement`) splits one payment (points + a chosen method) across selected invoices oldest-first. A server action (`settleAccountAction`) re-validates everything against the database, then walks the plan calling the existing `record_payment` RPC once per leg — no new SQL. One shared client component (`SettleAccountPanel`) renders the invoice picker and payment form on both pages.

**Tech Stack:** Next.js App Router (server actions), TypeScript, Supabase (Postgres RPC `record_payment`, unchanged), Vitest, Tailwind classes matching the existing `RecordPaymentForm` styling.

**Spec:** `docs/superpowers/specs/2026-08-22-account-settlement-design.md`

---

### Task 1: Shared "what's open" query + refactor the aged statement to use it

**Files:**
- Modify: `apps/web/src/lib/supabase/queries/reports.ts`

- [ ] **Step 1: Add `getSettleableInvoices` and `getCustomerPointsContext`, just above `getCustomerAgedStatement`**

Open `apps/web/src/lib/supabase/queries/reports.ts` and find the `getCustomerAgedStatement` function (it starts right after the `AgedStatement` interface, around line 574). Insert the following two exported functions **immediately before** `export async function getCustomerAgedStatement`:

```ts
export interface SettleableInvoice {
  id: string;
  number: string | null;
  issueDate: string | null;
  outstandingCents: number; // total_incl - amount_paid — what's still owed
  paidCents: number; // amount_paid so far — the aged statement's "credit" column
}

/**
 * Every open (not fully paid, not credited) invoice for a customer, oldest first —
 * the same "what do they actually owe" filter the aged statement below uses, pulled
 * out so account settlement can never offer to settle an invoice the statement
 * wouldn't itself count as owed.
 */
export async function getSettleableInvoices(customerId: string): Promise<SettleableInvoice[]> {
  const sb = await createClient();
  const rows = await fetchAllRows(() =>
    sb.from("documents").select("id, doc_type, status, number, total_incl, amount_paid, issue_date, source_document_id").eq("customer_id", customerId).in("doc_type", ["invoice", "credit_note"]).in("status", ["issued", "partly_paid", "paid"]),
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const docs = rows as any[];
  const creditedIds = new Set(docs.filter((d) => d.doc_type === "credit_note").map((d) => d.source_document_id).filter(Boolean));

  const open: SettleableInvoice[] = [];
  for (const d of docs) {
    if (d.doc_type !== "invoice") continue;
    if (!["issued", "partly_paid"].includes(d.status)) continue;
    if (creditedIds.has(d.id)) continue;
    const outstandingCents = rupeesToCents(Number(d.total_incl) - Number(d.amount_paid));
    if (outstandingCents <= 0) continue;
    open.push({ id: d.id, number: d.number, issueDate: d.issue_date, outstandingCents, paidCents: rupeesToCents(Number(d.amount_paid)) });
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return open.sort((a, b) => {
    const ak = a.issueDate ?? "9999-99-99";
    const bk = b.issueDate ?? "9999-99-99";
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
}

export interface CustomerPointsContext {
  pointsBalance: number;
  pointValueRupees: number;
  pointsEnabled: boolean;
}

/** The points figures account settlement needs, for a customer the caller already knows. */
export async function getCustomerPointsContext(customerId: string): Promise<CustomerPointsContext> {
  const sb = await createClient();
  const [{ data: cust }, { data: bs }] = await Promise.all([
    sb.from("customers").select("points_balance").eq("id", customerId).maybeSingle(),
    sb.from("business_settings").select("point_value_rupees, points_enabled").limit(1).maybeSingle(),
  ]);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    pointsBalance: (cust as any)?.points_balance ?? 0,
    pointValueRupees: Number((bs as any)?.point_value_rupees ?? 1),
    pointsEnabled: (bs as any)?.points_enabled !== false,
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
```

- [ ] **Step 2: Refactor `getCustomerAgedStatement` to build its invoice list from `getSettleableInvoices`**

Replace the **entire body** of `getCustomerAgedStatement` (from `export async function getCustomerAgedStatement` through its closing `}`) with:

```ts
export async function getCustomerAgedStatement(customerId: string, refDate = muToday()): Promise<AgedStatement | null> {
  const sb = await createClient();
  const [{ data: cust }, openInvoices, lineRows] = await Promise.all([
    sb.from("customers").select("id, name, email, notes").eq("id", customerId).maybeSingle(),
    getSettleableInvoices(customerId),
    fetchAllRows(() =>
      sb.from("document_lines").select("document_id, title, qty, discount_pct, sort_order, documents!inner(customer_id)").eq("documents.customer_id", customerId),
    ),
  ]);
  if (!cust) return null;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const linesByDoc = new Map<string, StatementInvoiceLine[]>();
  for (const l of (lineRows as any[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    const arr = linesByDoc.get(l.document_id) ?? [];
    arr.push({ title: l.title, qty: Number(l.qty), discountPct: Number(l.discount_pct ?? 0) });
    linesByDoc.set(l.document_id, arr);
  }

  const keys = agingKeys(refDate);
  const buckets: StatementAgingBucket[] = keys.map((k) => ({ key: k, label: monthLabel(k), cents: 0 }));
  const avant: StatementAgingBucket = { key: "avant", label: "Avant", cents: 0 };

  const carried = parseLegacyBalance((cust as any).notes);
  const carriedCents = carried?.netCents ?? 0;
  avant.cents += carriedCents; // historical debt is older than any shown month

  // getSettleableInvoices already sorts oldest-first and excludes anything credited
  // or fully paid — this used to re-derive that same filter from raw document rows.
  const invoices: StatementCreditInvoice[] = openInvoices.map((inv) => {
    const key = inv.issueDate ? monthKey(inv.issueDate) : "avant";
    const bucket = buckets.find((b) => b.key === key) ?? avant;
    bucket.cents += inv.outstandingCents;
    return {
      date: inv.issueDate ?? "",
      number: inv.number,
      lines: linesByDoc.get(inv.id) ?? [],
      debitCents: inv.outstandingCents,
      creditCents: inv.paidCents,
    };
  });

  const allBuckets = [...buckets, avant];
  const soldeCents = allBuckets.reduce((s, b) => s + b.cents, 0);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    customerId,
    customerName: (cust as any).name,
    customerEmail: (cust as any).email ?? null,
    refDate,
    soldeCents,
    buckets: allBuckets,
    carriedCents,
    invoices,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors (pre-existing unrelated errors, if any, are not yours to fix here).

- [ ] **Step 4: Manually confirm the refactor didn't change the statement's output**

This function has no unit test today (it's a DB-reading query, not pure logic), so confirm behaviour is unchanged in the browser once the dev server is available — defer the actual check to Task 8's manual verification, which re-checks the Statement page. For now just re-read the diff: the `invoices` array and `buckets` totals are built from the exact same three conditions (`doc_type === 'invoice'`, status in `issued`/`partly_paid`, not in `creditedIds`) as before, just sourced from `getSettleableInvoices` instead of inline filtering.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/supabase/queries/reports.ts
git commit -m "$(cat <<'EOF'
refactor(reports): extract the open-invoice filter into getSettleableInvoices

Pulled the aged statement's "not fully paid, not credited" filter into its
own function so account settlement (next commits) can offer exactly the
invoices the statement itself would count as owed, instead of re-deriving
the same filter a second time.
EOF
)"
```

---

### Task 2: Pure settlement-allocation algorithm, test-first

**Files:**
- Create: `apps/web/src/features/documents/account-settlement.ts`
- Create: `apps/web/src/features/documents/account-settlement.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/documents/account-settlement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planSettlement } from "./account-settlement";

const inv = (id: string, issueDate: string | null, outstandingCents: number) => ({ id, issueDate, outstandingCents });

describe("planSettlement", () => {
  it("pays a single invoice in full with cash, tendered exactly", () => {
    const legs = planSettlement([inv("a", "2026-08-01", 150_000)], 0, "cash", 150_000);

    expect(legs).toEqual([{ invoiceId: "a", method: "cash", amountCents: 150_000, tenderedCents: 150_000 }]);
  });

  it("orders invoices oldest first regardless of input order", () => {
    const legs = planSettlement(
      [inv("newer", "2026-08-10", 10_000), inv("older", "2026-08-01", 20_000)],
      0,
      "card",
      null,
    );

    expect(legs.map((l) => l.invoiceId)).toEqual(["older", "newer"]);
  });

  it("treats a missing issue date as the newest — sorted after every dated invoice", () => {
    const legs = planSettlement(
      [inv("undated", null, 5_000), inv("dated", "2026-01-01", 5_000)],
      0,
      "card",
      null,
    );

    expect(legs.map((l) => l.invoiceId)).toEqual(["dated", "undated"]);
  });

  it("puts all of a cash overpayment's change on the LAST leg, not spread across invoices", () => {
    // Two invoices, Rs 1,000 and Rs 500 (oldest first). Customer hands over Rs 2,000 —
    // Rs 1,500 due, Rs 500 change. The change must land once, on the final leg, not be
    // double-counted or dropped by splitting it evenly.
    const legs = planSettlement([inv("a", "2026-08-01", 100_000), inv("b", "2026-08-05", 50_000)], 0, "cash", 200_000);

    expect(legs).toEqual([
      { invoiceId: "a", method: "cash", amountCents: 100_000, tenderedCents: 100_000 },
      { invoiceId: "b", method: "cash", amountCents: 50_000, tenderedCents: 100_000 },
    ]);
    // leg "b"'s change: 100_000 tendered - 50_000 amount = 50_000 — the true overall change.
  });

  it("splits points across an invoice boundary, then covers the rest by the chosen method", () => {
    // inv1 owes Rs 30, inv2 owes Rs 50. Rs 40 in points: Rs 30 clears inv1 outright,
    // the remaining Rs 10 comes off inv2, leaving Rs 40 of inv2 for the card.
    const legs = planSettlement(
      [inv("inv1", "2026-08-01", 3_000), inv("inv2", "2026-08-05", 5_000)],
      4_000,
      "card",
      null,
    );

    expect(legs).toEqual([
      { invoiceId: "inv1", method: "points", amountCents: 3_000, tenderedCents: null },
      { invoiceId: "inv2", method: "points", amountCents: 1_000, tenderedCents: null },
      { invoiceId: "inv2", method: "card", amountCents: 4_000, tenderedCents: null },
    ]);
  });

  it("emits no method leg at all when points cover everything", () => {
    const legs = planSettlement([inv("a", "2026-08-01", 2_000), inv("b", "2026-08-02", 3_000)], 5_000, "cash", null);

    expect(legs).toEqual([
      { invoiceId: "a", method: "points", amountCents: 2_000, tenderedCents: null },
      { invoiceId: "b", method: "points", amountCents: 3_000, tenderedCents: null },
    ]);
  });

  it("never sets a tendered amount on a non-cash leg", () => {
    const legs = planSettlement([inv("a", "2026-08-01", 10_000)], 0, "bank_transfer", null);

    expect(legs).toEqual([{ invoiceId: "a", method: "bank_transfer", amountCents: 10_000, tenderedCents: null }]);
  });

  it("every leg for one invoice sums back to exactly its outstanding balance", () => {
    const invoices = [inv("a", "2026-08-01", 7_777), inv("b", "2026-08-02", 12_345)];
    const legs = planSettlement(invoices, 3_000, "juice", null);

    for (const original of invoices) {
      const sum = legs.filter((l) => l.invoiceId === original.id).reduce((s, l) => s + l.amountCents, 0);
      expect(sum).toBe(original.outstandingCents);
    }
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail because the module doesn't exist yet**

Run: `cd apps/web && npx vitest run src/features/documents/account-settlement.test.ts`
Expected: FAIL — `Cannot find module './account-settlement'` (or similar resolution error).

- [ ] **Step 3: Implement `planSettlement`**

Create `apps/web/src/features/documents/account-settlement.ts`:

```ts
/**
 * Account settlement's allocation rule: one payment (an optional points amount, plus
 * a chosen method for the rest) is split across several invoices, oldest first. Every
 * invoice is always paid in full — points are applied invoice-by-invoice until they
 * run out, then the chosen method covers whatever remains on that invoice, before
 * moving to the next. Pure and DB-free; `settleAccountAction` turns each leg into a
 * `record_payment` call.
 *
 * Cash tendered/change is not per-invoice: the customer hands over one amount for the
 * whole settlement. Every cash leg before the last is recorded as exact change
 * (tendered = amount); the LAST cash leg receives whatever remains of the customer's
 * tendered total, so its change resolves to the true overall change instead of being
 * spread — or lost — across several rows.
 */

export type SettleMethod = "cash" | "card" | "juice" | "bank_transfer";
export type LegMethod = SettleMethod | "points";

export interface SettleInvoiceInput {
  id: string;
  issueDate: string | null; // yyyy-mm-dd
  outstandingCents: number;
}

export interface SettlementLeg {
  invoiceId: string;
  method: LegMethod;
  amountCents: number;
  tenderedCents: number | null; // set only on a cash leg
}

export function planSettlement(
  invoices: SettleInvoiceInput[],
  pointsAppliedCents: number,
  method: SettleMethod,
  tenderedCents: number | null,
): SettlementLeg[] {
  const sorted = [...invoices].sort((a, b) => {
    const ak = a.issueDate ?? "9999-99-99";
    const bk = b.issueDate ?? "9999-99-99";
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });

  let remainingPoints = Math.max(pointsAppliedCents, 0);
  const splits = sorted.map((inv) => {
    const pointsCents = Math.min(remainingPoints, inv.outstandingCents);
    remainingPoints -= pointsCents;
    return { id: inv.id, pointsCents, methodCents: inv.outstandingCents - pointsCents };
  });

  const methodIds = splits.filter((s) => s.methodCents > 0).map((s) => s.id);
  const lastMethodId = methodIds.length > 0 ? methodIds[methodIds.length - 1] : null;

  let tenderedRemaining = tenderedCents ?? 0;
  const legs: SettlementLeg[] = [];
  for (const s of splits) {
    if (s.pointsCents > 0) {
      legs.push({ invoiceId: s.id, method: "points", amountCents: s.pointsCents, tenderedCents: null });
    }
    if (s.methodCents > 0) {
      if (method === "cash") {
        const isLast = s.id === lastMethodId;
        const rowTendered = isLast ? tenderedRemaining : s.methodCents;
        legs.push({ invoiceId: s.id, method, amountCents: s.methodCents, tenderedCents: rowTendered });
        tenderedRemaining -= rowTendered;
      } else {
        legs.push({ invoiceId: s.id, method, amountCents: s.methodCents, tenderedCents: null });
      }
    }
  }
  return legs;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd apps/web && npx vitest run src/features/documents/account-settlement.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/documents/account-settlement.ts apps/web/src/features/documents/account-settlement.test.ts
git commit -m "$(cat <<'EOF'
feat(documents): add the account-settlement allocation algorithm

Pure function splitting one payment (points + a chosen method) across
several invoices oldest-first, each invoice always paid in full. No DB
access — settleAccountAction (next commit) turns each leg into a
record_payment call.
EOF
)"
```

---

### Task 3: Server action `settleAccountAction`

**Files:**
- Modify: `apps/web/src/features/documents/actions.ts`

- [ ] **Step 1: Add the imports this action needs**

At the top of `apps/web/src/features/documents/actions.ts`, add these two lines alongside the existing imports (after the `saveDraftInputSchema` import line):

```ts
import { formatMUR } from "@/lib/money";
import { pointsValueCents } from "@/lib/points";
import { getSettleableInvoices, getCustomerPointsContext } from "@/lib/supabase/queries/reports";
import { planSettlement } from "./account-settlement";
```

- [ ] **Step 2: Add the schema and action**

Add the following at the end of `apps/web/src/features/documents/actions.ts` (after `getApprovingOwnersAction`):

```ts
// ── Account settlement ───────────────────────────────────────────────────────
// Pays off several of a customer's open invoices in one action: points (if any)
// then a chosen method, walked oldest-first by planSettlement, one record_payment
// call per leg — no new RPC. See docs/superpowers/specs/2026-08-22-account-settlement-design.md.

const settleAccountSchema = z.object({
  customerId: z.string(),
  invoiceIds: z.array(z.string()).min(1),
  pointsAppliedCents: z.number().int().min(0),
  method: z.enum(["cash", "card", "juice", "bank_transfer"]),
  tenderedCents: z.number().int().nullable().optional(),
  externalRef: z.string().nullable().optional(),
  settleKey: z.string().min(1),
});

export type SettleAccountResult =
  | { ok: true; settledCount: number; settledCents: number }
  | { ok: false; error: string; settledCount: number; settledCents: number };

export async function settleAccountAction(
  input: z.infer<typeof settleAccountSchema>,
): Promise<SettleAccountResult> {
  await requireRole(...WRITE_ROLES);
  const parsed = settleAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid settlement request.", settledCount: 0, settledCents: 0 };
  const { customerId, invoiceIds, pointsAppliedCents, method, settleKey } = parsed.data;
  const externalRef = parsed.data.externalRef ?? null;
  const sb = await createClient();

  // Never trust the client's copy of what's owed — re-fetch server-side.
  const [open, points] = await Promise.all([getSettleableInvoices(customerId), getCustomerPointsContext(customerId)]);
  const byId = new Map(open.map((inv) => [inv.id, inv]));
  const selected = invoiceIds.map((id) => byId.get(id)).filter((inv): inv is NonNullable<typeof inv> => inv != null);
  if (selected.length !== invoiceIds.length) {
    return { ok: false, error: "One or more selected invoices are no longer open — refresh and try again.", settledCount: 0, settledCents: 0 };
  }

  const totalDueCents = selected.reduce((s, inv) => s + inv.outstandingCents, 0);
  const pointsCapCents = points.pointsEnabled ? Math.min(totalDueCents, pointsValueCents(points.pointsBalance, points.pointValueRupees)) : 0;
  if (pointsAppliedCents > pointsCapCents) {
    return { ok: false, error: "The points applied exceed what's available for this settlement.", settledCount: 0, settledCents: 0 };
  }

  const methodDueCents = totalDueCents - pointsAppliedCents;
  let tenderedCents = parsed.data.tenderedCents ?? null;
  if (methodDueCents > 0) {
    if (method === "cash") {
      tenderedCents = tenderedCents ?? methodDueCents;
      if (tenderedCents < methodDueCents) return { ok: false, error: "Tendered is less than the amount due.", settledCount: 0, settledCents: 0 };
    } else if (!externalRef?.trim()) {
      return { ok: false, error: "A card / Juice / bank payment needs a reference.", settledCount: 0, settledCents: 0 };
    }
  }

  const legs = planSettlement(
    selected.map((inv) => ({ id: inv.id, issueDate: inv.issueDate, outstandingCents: inv.outstandingCents })),
    pointsAppliedCents,
    method,
    methodDueCents > 0 ? tenderedCents : null,
  );

  // planSettlement always emits one invoice's legs (points, then method) consecutively —
  // re-group them so a whole invoice's legs succeed together before the next one starts.
  const groups: { invoiceId: string; legs: typeof legs }[] = [];
  for (const leg of legs) {
    const g = groups[groups.length - 1];
    if (g && g.invoiceId === leg.invoiceId) g.legs.push(leg);
    else groups.push({ invoiceId: leg.invoiceId, legs: [leg] });
  }

  // The DESK's till, same as every other web payment — never "any open till".
  const cashSessionId = await backOfficeTillId(sb);
  let settledCount = 0;
  let settledCents = 0;

  for (const group of groups) {
    let groupCents = 0;
    try {
      for (const leg of group.legs) {
        await rpc.recordPayment(sb, {
          invoiceId: leg.invoiceId,
          method: leg.method,
          amount: leg.amountCents / 100,
          tendered: leg.tenderedCents != null ? leg.tenderedCents / 100 : null,
          externalRef: leg.method === "cash" || leg.method === "points" ? null : externalRef?.trim() || null,
          cashSessionId,
          idempotencyKey: `${settleKey}-${leg.invoiceId}-${leg.method}`,
        });
        groupCents += leg.amountCents;
      }
      settledCount += 1;
      settledCents += groupCents;
    } catch (e) {
      const number = byId.get(group.invoiceId)?.number ?? group.invoiceId;
      const partialNote = groupCents > 0 ? ` (${formatMUR(groupCents)} of it already applied to that invoice)` : "";
      revalidatePath("/sales");
      revalidatePath("/contacts");
      revalidatePath("/reports");
      for (const g of groups.slice(0, groups.indexOf(group) + 1)) revalidatePath(`/sales/${g.invoiceId}`);
      return {
        ok: false,
        error: `Settled ${settledCount} of ${selected.length} invoice${selected.length === 1 ? "" : "s"} (${formatMUR(settledCents)}). Failed on ${number}${partialNote}: ${(e as Error).message}`,
        settledCount,
        settledCents,
      };
    }
  }

  revalidatePath("/sales");
  revalidatePath("/contacts");
  revalidatePath("/reports");
  for (const inv of selected) revalidatePath(`/sales/${inv.id}`);
  return { ok: true, settledCount, settledCents };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Lint**

Run: `cd apps/web && npm run lint`
Expected: no new errors in `actions.ts` (pre-existing `eslint-disable` comments elsewhere in the file are untouched).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/documents/actions.ts
git commit -m "$(cat <<'EOF'
feat(documents): add settleAccountAction

Walks planSettlement's legs through the existing record_payment RPC, one
call per leg, grouped so a whole invoice's legs succeed together before the
next starts. Re-validates every invoice and the points cap server-side
before touching the till. No new SQL.
EOF
)"
```

---

### Task 4: Shared UI — `SettleAccountPanel`

**Files:**
- Create: `apps/web/src/features/documents/SettleAccountPanel.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/features/documents/SettleAccountPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMUR, parseMoneyInput } from "@/lib/money";
import { pointsValueCents } from "@/lib/points";
import { muDate } from "@/lib/mu-date";
import { settleAccountAction } from "./actions";
import { btn } from "@/components/ui/button";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "juice", label: "Juice" },
  { value: "bank_transfer", label: "Bank transfer" },
] as const;

const field =
  "h-9 w-full rounded-[10px] border border-line-2 bg-sub px-2.5 text-[13px] text-ink outline-none focus:border-brand";
const lbl = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-faint";

export interface SettleableInvoiceView {
  id: string;
  number: string | null;
  issueDate: string | null;
  outstandingCents: number;
}

/** Settle several open invoices in one action — the multi-invoice sibling of
 *  RecordPaymentForm, sharing its points-then-method building blocks. Mounted
 *  on both the Contacts customer page and the Reports statement page. */
export function SettleAccountPanel({
  customerId,
  invoices,
  pointsEnabled = true,
  pointsBalance = 0,
  pointValueRupees = 1,
}: {
  customerId: string;
  invoices: SettleableInvoiceView[];
  pointsEnabled?: boolean;
  pointsBalance?: number;
  pointValueRupees?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState<string>("cash");
  const [pointsApplied, setPointsApplied] = useState(false);
  const [pointsText, setPointsText] = useState("");
  const [tendered, setTendered] = useState("");
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = invoices.filter((inv) => checked[inv.id]);
  const totalDueCents = selected.reduce((s, inv) => s + inv.outstandingCents, 0);
  const pointsCapCents = pointsEnabled ? Math.min(totalDueCents, pointsValueCents(pointsBalance, pointValueRupees)) : 0;
  const typedPointsCents = parseMoneyInput(pointsText) ?? 0;
  const pointsAppliedCents = pointsApplied ? Math.min(Math.max(typedPointsCents, 0), pointsCapCents) : 0;
  const methodDueCents = Math.max(totalDueCents - pointsAppliedCents, 0);
  const isCash = method === "cash";
  const tenderedCents = parseMoneyInput(tendered);
  const changeCents = isCash && tenderedCents != null ? tenderedCents - methodDueCents : null;

  function toggleInvoice(id: string) {
    setChecked((c) => ({ ...c, [id]: !c[id] }));
    setError(null);
    setSuccess(null);
  }
  function selectAll() {
    setChecked(Object.fromEntries(invoices.map((inv) => [inv.id, true])));
    setError(null);
    setSuccess(null);
  }
  function togglePoints() {
    const next = !pointsApplied;
    setPointsApplied(next);
    if (next) setPointsText((pointsCapCents / 100).toFixed(2));
    setTendered("");
    setError(null);
  }
  function changePoints(next: string) {
    setPointsText(next);
    setTendered("");
    setError(null);
  }

  async function submit() {
    setError(null);
    setSuccess(null);
    if (selected.length === 0) return setError("Select at least one invoice.");
    if (isCash && tenderedCents != null && tenderedCents < methodDueCents) return setError("Tendered is less than the amount due.");
    if (methodDueCents > 0 && !isCash && !ref.trim()) return setError("A card / Juice / bank payment needs a reference.");
    setBusy(true);

    const result = await settleAccountAction({
      customerId,
      invoiceIds: selected.map((inv) => inv.id),
      pointsAppliedCents,
      method: method as "cash" | "card" | "juice" | "bank_transfer",
      tenderedCents: isCash ? (tenderedCents ?? methodDueCents) : null,
      externalRef: isCash ? null : ref.trim(),
      settleKey: crypto.randomUUID(),
    });

    setBusy(false);
    if (result.ok) {
      setSuccess(`Settled ${result.settledCount} invoice${result.settledCount === 1 ? "" : "s"} for ${formatMUR(result.settledCents)}.`);
      setChecked({});
      setPointsApplied(false);
      setPointsText("");
      setTendered("");
      setRef("");
    } else {
      setError(result.error);
    }
    router.refresh(); // whatever DID settle should drop off the list either way
  }

  if (invoices.length === 0) return null;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={btn("ghost", "md")}>
        Settle account
      </button>
    );
  }

  return (
    <div className="rounded-[14px] border border-line bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-bold text-ink">Settle account</p>
        <button onClick={() => setOpen(false)} className="text-[12px] font-semibold text-muted">✕</button>
      </div>

      <div className="mb-3 overflow-hidden rounded-[10px] border border-line-2">
        <div className="flex items-center justify-between border-b border-line-2 bg-sub px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-faint">
            {invoices.length} open invoice{invoices.length === 1 ? "" : "s"}
          </span>
          <button onClick={selectAll} className="text-[11.5px] font-semibold text-link hover:underline">Select all</button>
        </div>
        {invoices.map((inv) => (
          <label key={inv.id} className="flex cursor-pointer items-center gap-2.5 border-b border-line-2 px-3 py-2 last:border-b-0 hover:bg-sub">
            <input type="checkbox" checked={!!checked[inv.id]} onChange={() => toggleInvoice(inv.id)} className="size-4" />
            <span className="num flex-1 text-[12px] font-semibold text-link">{inv.number ?? "—"}</span>
            <span className="num text-[11.5px] text-muted">{inv.issueDate ? muDate(`${inv.issueDate}T00:00:00+04:00`) : "—"}</span>
            <span className="num w-24 text-right text-[12.5px] font-bold text-ink">{formatMUR(inv.outstandingCents)}</span>
          </label>
        ))}
      </div>

      {selected.length > 0 && (
        <>
          <div className="mb-3 flex justify-between text-[13px]">
            <span className="font-semibold text-muted">Total due</span>
            <span className="num font-extrabold text-ink">{formatMUR(totalDueCents)}</span>
          </div>

          {pointsCapCents > 0 && (
            <button
              type="button"
              onClick={togglePoints}
              className={`mb-3 flex w-full items-center justify-between rounded-[10px] border px-3 py-2.5 text-left ${
                pointsApplied ? "border-link bg-[rgba(43,140,255,0.08)]" : "border-line-2 bg-sub"
              }`}
            >
              <span>
                <span className="block text-[12.5px] font-bold text-ink">
                  {pointsApplied
                    ? `${formatMUR(pointsAppliedCents)} in points off this settlement`
                    : `${pointsBalance} pts available — worth ${formatMUR(pointsValueCents(pointsBalance, pointValueRupees))}`}
                </span>
                <span className="block text-[11.5px] text-muted">
                  {pointsApplied ? `${formatMUR(methodDueCents)} left to pay — click to undo` : "Click to choose how much of it to use"}
                </span>
              </span>
              <span className="text-[11px] font-bold tracking-[0.06em] text-link">{pointsApplied ? "APPLIED" : "APPLY"}</span>
            </button>
          )}

          {pointsApplied && (
            <div className="mb-3 rounded-[10px] border border-line-2 bg-sub p-3">
              <div className="flex items-end gap-2">
                <label className="block flex-1">
                  <span className={lbl}>Points to use (Rs)</span>
                  <input className={`${field} num text-right`} value={pointsText} onChange={(e) => changePoints(e.target.value)} inputMode="decimal" />
                </label>
                <button type="button" onClick={() => changePoints((pointsCapCents / 100).toFixed(2))} className={btn("ghost", "md")}>
                  Use all
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={lbl}>Method</span>
              <select className={field} value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>
            <div className="block">
              <span className={lbl}>Amount due</span>
              <div className={`${field} num flex items-center justify-end text-body`}>{formatMUR(methodDueCents)}</div>
            </div>

            {isCash ? (
              <>
                <label className="block">
                  <span className={lbl}>Tendered (Rs)</span>
                  <input className={`${field} num text-right`} value={tendered} onChange={(e) => setTendered(e.target.value)} inputMode="decimal" placeholder={(methodDueCents / 100).toFixed(2)} />
                </label>
                <div className="block">
                  <span className={lbl}>Change</span>
                  <div className={`${field} num flex items-center justify-end ${changeCents != null && changeCents < 0 ? "text-rose" : "text-body"}`}>
                    {changeCents != null ? formatMUR(changeCents) : "—"}
                  </div>
                </div>
              </>
            ) : methodDueCents > 0 ? (
              <label className="col-span-2 block">
                <span className={lbl}>External reference</span>
                <input className={field} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Terminal / transaction ref" />
              </label>
            ) : null}
          </div>

          {error && <p className="mt-3 text-[12px] text-rose">{error}</p>}
          {success && <p className="mt-3 text-[12px] font-semibold text-mint">{success}</p>}

          <button onClick={submit} disabled={busy || selected.length === 0} className={btn("primary", "md", "mt-4 w-full")}>
            {busy
              ? "Settling…"
              : pointsAppliedCents > 0 && methodDueCents > 0
                ? `Settle ${formatMUR(methodDueCents)} + ${formatMUR(pointsAppliedCents)} in points`
                : pointsAppliedCents > 0
                  ? `Settle ${formatMUR(pointsAppliedCents)} in points`
                  : `Settle ${formatMUR(totalDueCents)}`}
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Lint**

Run: `cd apps/web && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/documents/SettleAccountPanel.tsx
git commit -m "$(cat <<'EOF'
feat(documents): add the SettleAccountPanel component

Invoice checkbox list + points/method payment form, sized to the checked
invoices' total instead of one document's balance. Shared by both entry
points added in the next two commits.
EOF
)"
```

---

### Task 5: Wire into the Contacts customer page

**Files:**
- Modify: `apps/web/src/app/(app)/contacts/page.tsx`

- [ ] **Step 1: Import the panel and the query, and fetch the selected customer's settleable invoices**

In `apps/web/src/app/(app)/contacts/page.tsx`, add to the imports (near the `PointsPanel` import):

```tsx
import { SettleAccountPanel } from "@/features/documents/SettleAccountPanel";
import { getSettleableInvoices } from "@/lib/supabase/queries/reports";
```

Then, right after this existing line:

```tsx
  const [data, session] = await Promise.all([getContacts(sp.c), getSessionContext()]);
  const sel = data.selected;
```

add:

```tsx
  const settleable = sel ? await getSettleableInvoices(sel.id) : [];
```

- [ ] **Step 2: Render the panel next to the Outstanding balance card**

Find this block (the two summary cards):

```tsx
              <div className="grid grid-cols-2 gap-3 p-[22px]">
                <div className="rounded-[12px] border border-line p-4">
                  <div className="text-[11.5px] font-semibold text-muted">Lifetime spend</div>
                  <div className="num mt-1.5 text-[22px] font-extrabold text-ink-strong">{formatMUR(sel.spendCents)}</div>
                </div>
                <div className="rounded-[12px] border border-line p-4">
                  <div className="text-[11.5px] font-semibold text-muted">Outstanding balance</div>
                  <div className={`num mt-1.5 text-[22px] font-extrabold ${sel.outstandingCents > 0 ? "text-amber-ink" : "text-ink-strong"}`}>{formatMUR(sel.outstandingCents)}</div>
                </div>
              </div>
```

Add this immediately after it (still inside the same parent `<div>`):

```tsx
              {settleable.length > 0 && (
                <div className="px-[22px] pb-2">
                  <SettleAccountPanel
                    customerId={sel.id}
                    invoices={settleable}
                    pointsEnabled={sel.pointsEnabled}
                    pointsBalance={sel.pointsBalance}
                    pointValueRupees={sel.pointValueRupees}
                  />
                </div>
              )}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/contacts/page.tsx"
git commit -m "$(cat <<'EOF'
feat(contacts): add Settle account to the customer detail page

Shown beside the existing Outstanding balance card whenever the customer
has open invoices. No role gate here — the page itself has none, matching
how RecordPaymentForm is shown on /sales/[id] regardless of viewer role
and lets settleAccountAction's own owner/manager/cashier check decide.
EOF
)"
```

---

### Task 6: Wire into Reports → Statement of accounts

**Files:**
- Modify: `apps/web/src/app/(app)/reports/page.tsx`

- [ ] **Step 1: Import what's needed and fetch session + settleable invoices + points context for the selected customer**

Add to the imports at the top of `apps/web/src/app/(app)/reports/page.tsx`:

```tsx
import { SettleAccountPanel } from "@/features/documents/SettleAccountPanel";
import { getSettleableInvoices, getCustomerPointsContext } from "@/lib/supabase/queries/reports";
import { getSessionContext } from "@/lib/auth/session";
```

Find this block:

```tsx
  const statement =
    report === "statement"
      ? {
          customers: await getStatementCustomers(),
          data: sp.c ? await getCustomerStatement(sp.c, sp.from, sp.to) : null,
          aged: sp.c ? await getCustomerAgedStatement(sp.c) : null,
        }
      : null;
```

Replace it with:

```tsx
  // Owner/manager only — an accountant can view this page (reports/layout.tsx
  // allows owner|manager|accountant) but never records real payments, matching
  // every other payment-recording action in the app.
  const session = report === "statement" && sp.c ? await getSessionContext() : null;
  const canSettle = session?.role === "owner" || session?.role === "manager";
  const statement =
    report === "statement"
      ? {
          customers: await getStatementCustomers(),
          data: sp.c ? await getCustomerStatement(sp.c, sp.from, sp.to) : null,
          aged: sp.c ? await getCustomerAgedStatement(sp.c) : null,
          settleable: sp.c && canSettle ? await getSettleableInvoices(sp.c) : [],
          points: sp.c && canSettle ? await getCustomerPointsContext(sp.c) : null,
        }
      : null;
```

- [ ] **Step 2: Render the panel above the "Balance — aged" card**

Find this block (the start of the per-customer statement view, right after the customer picker / PDF / send-button row):

```tsx
              {statement.aged && statement.aged.soldeCents !== 0 && (
                <div className="overflow-hidden rounded-[15px] border border-line bg-card">
                  <div className="border-b border-line px-5 py-3.5 font-display text-[14px] font-bold text-ink-strong">Balance — aged</div>
```

Insert this immediately **before** that `{statement.aged && ...}` block (same indentation level, still inside the outer `report === "statement"` fragment):

```tsx
              {statement.settleable.length > 0 && statement.points && (
                <SettleAccountPanel
                  customerId={sp.c!}
                  invoices={statement.settleable}
                  pointsEnabled={statement.points.pointsEnabled}
                  pointsBalance={statement.points.pointsBalance}
                  pointValueRupees={statement.points.pointValueRupees}
                />
              )}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors. (`sp.c!` is safe here — `statement.settleable` is only ever non-empty when `sp.c` was set, per Step 1.)

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/reports/page.tsx"
git commit -m "$(cat <<'EOF'
feat(reports): add Settle account to the per-customer statement view

Owner/manager only — an accountant can view this page but the settlement
control isn't rendered for them, matching how every other payment-recording
action in the app is gated to owner|manager|cashier.
EOF
)"
```

---

### Task 7: Live-DB probe script

**Files:**
- Create: `scripts/_verify-settle-account.mjs`

- [ ] **Step 1: Write the probe**

Create `scripts/_verify-settle-account.mjs`:

```js
// Rolled-back verification that settling several invoices in one action behaves the
// way account-settlement.ts's planSettlement (and settleAccountAction, which calls
// the SAME record_payment RPC per leg) expects: points split across an invoice
// boundary, the remainder taken by a chosen method, each invoice landing on 'paid',
// and the points ledger moving by exactly what was spent. No new SQL exists for this
// feature — this exercises record_payment exactly as the server action calls it,
// back-to-back for two invoices on one till session. Always ROLLS BACK.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const SANDBOX_AUTH = "b729191b-1159-4d46-88c7-3c9aceb5e664"; // TEST Sandbox (owner) — no trading day today

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
const asUser = async (authUid) => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: authUid, role: "authenticated" }),
  ]);
};
const mkLine = (unitPrice) => ({
  product_id: null, title: "Settle probe line", description: null, qty: 1, unit_price: unitPrice,
  discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 0,
  sort_order: 0, line_kind: "product",
});

try {
  await c.query("begin");
  await asUser(SANDBOX_AUTH);
  const tenant = (await c.query("select app.current_tenant_id() as t")).rows[0].t;

  const owner = (await c.query(
    "select id from public.app_users where tenant_id=$1 and role='owner' and is_active limit 1", [tenant],
  )).rows[0].id;
  const cust = (await c.query(
    "insert into public.customers (tenant_id, name) values ($1,'Settle Account Probe') returning id",
    [tenant],
  )).rows[0].id;

  // Seed a points balance directly on the ledger — customer_points_ledger has no
  // INSERT policy for `authenticated`, every real write goes through a SECURITY
  // DEFINER RPC, so this is table-owner seeding exactly like _verify-points.mjs does.
  await c.query("set local role postgres");
  await c.query(
    `insert into public.customer_points_ledger (tenant_id, customer_id, delta, reason, ref_type, ref_id, created_by)
     values ($1,$2,40,'adjusted',null,null,$3)`,
    [tenant, cust, owner],
  );
  await asUser(SANDBOX_AUTH);
  const before = (await c.query("select points_balance from public.customers where id=$1", [cust])).rows[0].points_balance;
  check("seeded 40 points before settling", before, 40);

  let till = (await c.query(
    "select id, status from public.cash_sessions where tenant_id=$1 and status='open' limit 1", [tenant],
  )).rows[0];
  if (!till) till = (await c.query("select id, status from public.open_cash_session('SETTLE-ACCOUNT-VERIFY', 0)")).rows[0];
  check("a till is open", till.status, "open");

  console.log("▸ two invoices: Rs 30 (older) and Rs 50 (newer)");
  const draft1 = (await c.query(
    "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: cust }), JSON.stringify([mkLine(30)])],
  )).rows[0];
  const inv1 = (await c.query("select * from public.issue_document($1::uuid, null, null, null)", [draft1.id])).rows[0];
  check("invoice 1 total", inv1.total_incl, "30.00");

  const draft2 = (await c.query(
    "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: cust }), JSON.stringify([mkLine(50)])],
  )).rows[0];
  const inv2 = (await c.query("select * from public.issue_document($1::uuid, null, null, null)", [draft2.id])).rows[0];
  check("invoice 2 total", inv2.total_incl, "50.00");

  // planSettlement's plan for (points=40, method=cash): inv1 gets a Rs 30 points leg
  // (fully covering it), inv2 gets a Rs 10 points leg then a Rs 40 cash leg.
  console.log("▸ settling both: Rs 40 in points (spans the invoice boundary) + cash for the rest");
  await c.query(
    "select * from public.record_payment($1::uuid, 'points'::payment_method, 30, null, null, $2::uuid, null, $3)",
    [inv1.id, till.id, "probe-settle-inv1-points"],
  );
  await c.query(
    "select * from public.record_payment($1::uuid, 'points'::payment_method, 10, null, null, $2::uuid, null, $3)",
    [inv2.id, till.id, "probe-settle-inv2-points"],
  );
  await c.query(
    "select * from public.record_payment($1::uuid, 'cash'::payment_method, 40, 40, null, $2::uuid, null, $3)",
    [inv2.id, till.id, "probe-settle-inv2-cash"],
  );

  const status1 = (await c.query("select status, amount_paid from public.documents where id=$1", [inv1.id])).rows[0];
  check("invoice 1 is fully paid", status1.status, "paid");
  check("invoice 1 amount_paid", status1.amount_paid, "30.00");
  const status2 = (await c.query("select status, amount_paid from public.documents where id=$1", [inv2.id])).rows[0];
  check("invoice 2 is fully paid", status2.status, "paid");
  check("invoice 2 amount_paid", status2.amount_paid, "50.00");

  const afterBalance = (await c.query("select points_balance from public.customers where id=$1", [cust])).rows[0].points_balance;
  check("exactly 40 points were spent (40 seeded - 40 spent = 0)", afterBalance, 0);

  const redeemed = await c.query(
    "select ref_id, delta from public.customer_points_ledger where reason='redeemed' and customer_id=$1 order by created_at",
    [cust],
  );
  check("two redeemed ledger rows, one per invoice", redeemed.rows.length, 2);
  check("first redeemed row is against invoice 1, for -30", `${redeemed.rows[0].ref_id}:${redeemed.rows[0].delta}`, `${inv1.id}:-30`);
  check("second redeemed row is against invoice 2, for -10", `${redeemed.rows[1].ref_id}:${redeemed.rows[1].delta}`, `${inv2.id}:-10`);

  const payments = await c.query(
    "select document_id, method, amount from public.payments where document_id in ($1,$2) order by created_at",
    [inv1.id, inv2.id],
  );
  check("three payment rows total (one on inv1, two on inv2)", payments.rows.length, 3);

  await c.query("rollback");
  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`} (rolled back — nothing persisted)`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (err) {
  try { await c.query("rollback"); } catch {}
  console.error("✗ verify error:", err.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
```

- [ ] **Step 2: Run it**

Run: `node scripts/_verify-settle-account.mjs`
Expected: `✓ ALL CHECKS PASSED (rolled back — nothing persisted)`, exit code 0. If `DB_URL`/`_env.mjs` needs the sandbox disabled port guard mentioned in project memory, follow whatever the last successful run of `scripts/_verify-points.mjs` in this environment required (same connection, no new setup).

- [ ] **Step 3: Commit**

```bash
git add scripts/_verify-settle-account.mjs
git commit -m "$(cat <<'EOF'
test(scripts): add a rolled-back DB probe for account settlement

Proves record_payment, called back-to-back exactly as settleAccountAction
calls it, correctly splits points across an invoice boundary and lands
both invoices on 'paid' with the right payments and points-ledger rows.
EOF
)"
```

---

### Task 8: Full verification and final check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd apps/web && npm run test`
Expected: all tests pass, including the 8 new `account-settlement.test.ts` cases.

- [ ] **Step 2: Full lint pass**

Run: `cd apps/web && npm run lint`
Expected: no errors.

- [ ] **Step 3: Full build**

Run: `cd apps/web && npm run build`
Expected: build succeeds (this also fully typechecks every file touched, including the two `.tsx` pages).

- [ ] **Step 4: Manual browser verification — Contacts entry point**

Start the dev server, sign in as an owner/manager/cashier (see project memory on `scripts/_mint-session.mjs` if a quick authenticated session is needed), open a customer in Contacts who has 2+ open invoices, click "Settle account", check two invoices, pick cash, confirm the total and change math, submit, and confirm both invoices disappear from the picker and their `/sales/[id]` pages now show `paid`.

- [ ] **Step 5: Manual browser verification — Reports entry point**

As an owner or manager, open Reports → Statement of accounts for the same (or another) customer with open invoices, confirm the "Settle account" panel appears above "Balance — aged", settle one invoice with points applied, and confirm the aged balance and "Credit invoices" table both update after the refresh. Then sign in as an accountant and confirm the panel does **not** appear on the same page.

- [ ] **Step 6: Confirm the spec's out-of-scope boundaries held**

Check that a customer whose only "debt" is the legacy carried-forward Cashmag note (no live invoices) shows no "Settle account" control at all (`settleable.length === 0`), and that `getContacts`' own outstanding-balance figure on the Contacts page is unchanged by this work.
