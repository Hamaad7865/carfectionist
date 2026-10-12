import { describe, expect, it } from "vitest";
import { paymentTrail } from "./payment-trail";

describe("paymentTrail", () => {
  it("reads a deposit then the balance as owed, then settled", () => {
    expect(paymentTrail("invoice", 365_700, [100_000, 265_700])).toEqual([
      { kind: "owed", leftCents: 265_700 },
      { kind: "settled" },
    ]);
  });

  it("puts the bill back to owed when a payment is reversed", () => {
    expect(paymentTrail("invoice", 82_500, [82_500, -82_500])).toEqual([
      { kind: "settled" },
      { kind: "owed", leftCents: 82_500 },
    ]);
  });

  // CN-0004: Rs 1,215.00 credited against INV-0312, refunded by Juice. The refund is a
  // negative mirror on the credit note, so "total − paid" read Rs 2,430.00 still to pay.
  it("never says a credit note is owed — its rows are the refund going out", () => {
    expect(paymentTrail("credit_note", 121_500, [-121_500])).toEqual([{ kind: "refunded" }]);
  });

  it("marks every leg of a split refund", () => {
    expect(paymentTrail("credit_note", 121_500, [-50_000, -71_500])).toEqual([
      { kind: "refunded" },
      { kind: "refunded" },
    ]);
  });

  // CN-0004 again, once voided: the refund row stays in the append-only ledger, but a
  // voided credit note refunded nothing that stands.
  it("does not call a voided credit note's row a refund", () => {
    expect(paymentTrail("credit_note", 121_500, [-121_500], true)).toEqual([{ kind: "voided" }]);
  });

  it("says nothing on a zero-total bill", () => {
    expect(paymentTrail("invoice", 0, [0])).toEqual([null]);
  });
});
