/**
 * Split tender: one invoice settled by several payments (cash + card, card + Juice…).
 *
 * Each part is its own `record_payment` under `${saleKey}:pay:${index}`. A retry after a lost
 * response therefore replays the parts that committed and records only the ones that did not —
 * so the parts are frozen with the basket for as long as a settle is unresolved: re-sending
 * DIFFERENT parts under the same keys would settle the customer against the wrong amounts.
 */

import { formatMUR } from "@/lib/money";

export type SplitMethod = "cash" | "card" | "juice" | "bank_transfer" | "cheque";

export interface SplitPart {
  method: SplitMethod;
  amountCents: number;
  /** Cash only: what the customer handed over for this part. */
  tenderedCents?: number | null;
  externalRef?: string | null;
}

export interface PlannedPayment {
  method: SplitMethod;
  /** Rupees — money crosses the RPC boundary in rupees. */
  amount: number;
  tendered: number | null;
  externalRef: string | null;
  idempotencyKey: string | null;
}

export type SplitPlan =
  | { ok: true; payments: PlannedPayment[]; changeCents: number }
  | { ok: false; error: string };

/** Why these parts cannot settle `totalCents` — or the payments to record, in order. */
export function planSplit(parts: SplitPart[], totalCents: number, saleKey: string | null): SplitPlan {
  if (parts.length < 2) return { ok: false, error: "A split needs at least two payments." };
  if (parts.some((p) => !Number.isInteger(p.amountCents) || p.amountCents <= 0)) {
    return { ok: false, error: "Every part of a split needs an amount above Rs 0.00." };
  }
  const cash = parts.filter((p) => p.method === "cash");
  if (cash.length > 1) return { ok: false, error: "Put all the cash in one part of the split." };
  const sum = parts.reduce((s, p) => s + p.amountCents, 0);
  if (sum !== totalCents) {
    const diff = totalCents - sum;
    return {
      ok: false,
      error: diff > 0 ? `The split is ${formatMUR(diff)} short of the total.` : `The split is ${formatMUR(-diff)} over the total.`,
    };
  }
  let changeCents = 0;
  const payments = parts.map((p, i): PlannedPayment => {
    const tendered = p.method === "cash" && p.tenderedCents != null ? p.tenderedCents : null;
    if (tendered != null) changeCents = Math.max(0, tendered - p.amountCents);
    return {
      method: p.method,
      amount: p.amountCents / 100,
      tendered: tendered != null ? tendered / 100 : null,
      // Cash cites nothing; a cheque number is optional; card/Juice/bank fall back to COUNTER.
      externalRef: p.method === "cash" ? null : p.method === "cheque" ? p.externalRef?.trim() || null : p.externalRef?.trim() || "COUNTER",
      idempotencyKey: saleKey ? `${saleKey}:pay:${i}` : null,
    };
  });
  const short = cash.find((p) => p.tenderedCents != null && p.tenderedCents < p.amountCents);
  if (short) return { ok: false, error: "The cash handed over is less than the cash part of the split." };
  return { ok: true, payments, changeCents };
}
