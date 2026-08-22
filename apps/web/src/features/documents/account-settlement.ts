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
