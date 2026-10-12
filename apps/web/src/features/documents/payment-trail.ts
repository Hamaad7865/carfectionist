/**
 * What each row of the sales page's payments panel says under itself — the running
 * story of a bill: "Rs 2,657.00 still to pay" after the deposit, "paid in full" on
 * the payment that settles it. Pure and DB-free.
 *
 * A credit note is not a bill. Its total is the invoice's, stored positive, and its
 * only payment rows are the refund's NEGATIVE mirrors (create_and_issue_credit_note)
 * — so "total − paid" there adds the refund on top of the total and reads as twice
 * the bill still owed. Money on a credit note only ever goes back out: every row is
 * a refund, and nothing is owed.
 *
 * A VOIDED credit note refunded nothing that stands. Its row cannot leave the
 * append-only ledger, so the row says the note was voided rather than "refunded".
 */

export type PaymentTrailNote =
  | { kind: "owed"; leftCents: number }
  | { kind: "settled" }
  | { kind: "refunded" }
  | { kind: "voided" }
  | null;

export function paymentTrail(
  docType: "quote" | "invoice" | "credit_note",
  totalCents: number,
  amountsCents: number[],
  voided = false,
): PaymentTrailNote[] {
  if (docType === "credit_note") return amountsCents.map(() => ({ kind: voided ? "voided" : "refunded" }));
  if (totalCents <= 0) return amountsCents.map(() => null);
  let runningCents = 0;
  return amountsCents.map((amountCents) => {
    runningCents += amountCents;
    const leftCents = Math.max(0, totalCents - runningCents);
    return leftCents > 0 ? { kind: "owed", leftCents } : { kind: "settled" };
  });
}
