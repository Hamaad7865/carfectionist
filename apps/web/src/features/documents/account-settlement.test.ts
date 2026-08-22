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
