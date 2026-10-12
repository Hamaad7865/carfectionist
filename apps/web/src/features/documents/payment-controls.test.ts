import { describe, expect, it } from "vitest";
import { paymentControls } from "./payment-controls";

const standing = { method: "juice", isReversal: false, wasReversed: false };
const manager = { canReverse: true, canChangeMethod: true };
const cashier = { canReverse: false, canChangeMethod: true };

describe("paymentControls", () => {
  it("offers a manager both corrections on a standing payment", () => {
    const c = paymentControls(standing, { creditedByNumber: null, ...manager });
    expect(c.reverse).toBe(true);
    expect(c.methodTargets).toEqual(["cash", "card", "bank_transfer", "cheque"]);
    expect(c.refundedBy).toBeNull();
  });

  // INV-0312: Rs 1,215.00 by Juice, credited by CN-0004. The refund's negative mirror
  // sits on the credit note, so nothing on the invoice says this payment was undone —
  // and both controls were offered, to be refused by the RPCs every time.
  it("offers nothing on a credited invoice — the credit note already handed the money back", () => {
    const c = paymentControls(standing, { creditedByNumber: "CN-0004", ...manager });
    expect(c.reverse).toBe(false);
    expect(c.methodTargets).toEqual([]);
  });

  it("names the credit note that refunded the payment", () => {
    expect(paymentControls(standing, { creditedByNumber: "CN-0004", ...manager }).refundedBy).toBe("CN-0004");
  });

  it("offers nothing on a reversal mirror", () => {
    const c = paymentControls({ ...standing, isReversal: true }, { creditedByNumber: null, ...manager });
    expect(c.reverse).toBe(false);
    expect(c.methodTargets).toEqual([]);
  });

  it("offers nothing on a payment a mirror already undid", () => {
    const c = paymentControls({ ...standing, wasReversed: true }, { creditedByNumber: null, ...manager });
    expect(c.reverse).toBe(false);
    expect(c.methodTargets).toEqual([]);
  });

  // A pair cancelled on the invoice BEFORE it was credited was never standing money, so
  // the credit note mirrored neither row (create_and_issue_credit_note skips them).
  it("does not call an already-cancelled pair refunded", () => {
    const credited = { creditedByNumber: "CN-0004", ...manager };
    expect(paymentControls({ ...standing, wasReversed: true }, credited).refundedBy).toBeNull();
    expect(paymentControls({ ...standing, isReversal: true }, credited).refundedBy).toBeNull();
  });

  it("never offers a cashier the reversal, only the method change", () => {
    const c = paymentControls(standing, { creditedByNumber: null, ...cashier });
    expect(c.reverse).toBe(false);
    expect(c.methodTargets).toContain("cash");
  });

  it("keeps a cashier off a cash payment altogether", () => {
    const c = paymentControls({ ...standing, method: "cash" }, { creditedByNumber: null, ...cashier });
    expect(c.methodTargets).toEqual([]);
  });

  it("offers no method change to a role that may not make one", () => {
    const c = paymentControls(standing, { creditedByNumber: null, canReverse: false, canChangeMethod: false });
    expect(c.methodTargets).toEqual([]);
  });
});
