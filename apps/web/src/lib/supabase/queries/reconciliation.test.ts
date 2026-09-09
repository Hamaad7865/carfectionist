import { describe, it, expect } from "vitest";
import {
  ageDays,
  buildCustomerAging,
  buildInvoiceTrails,
  buildOverdueCustomers,
  buildOverpayments,
  OVERDUE_GRACE_DAYS,
} from "./reconciliation";

const TODAY = "2026-09-10";

const open = [
  { id: "a", number: "INV-1", customerId: "c1", customerName: "Yash", issueDate: "2026-09-01", totalCents: 100_00, paidCents: 0, outstandingCents: 100_00 },
  { id: "b", number: "INV-2", customerId: "c1", customerName: "Yash", issueDate: "2026-07-01", totalCents: 200_00, paidCents: 50_00, outstandingCents: 150_00 },
  { id: "c", number: "INV-3", customerId: "c2", customerName: "Priya", issueDate: "2026-09-09", totalCents: 300_00, paidCents: 0, outstandingCents: 300_00 },
  { id: "d", number: null, customerId: "c2", customerName: "Priya", issueDate: null, totalCents: 40_00, paidCents: 0, outstandingCents: 40_00 },
];

describe("ageDays", () => {
  it("counts whole Mauritius days between bill date and today", () => {
    expect(ageDays("2026-09-10", TODAY)).toBe(0);
    expect(ageDays("2026-09-01", TODAY)).toBe(9);
    expect(ageDays("2026-07-01", TODAY)).toBe(71);
  });
});

describe("buildOverdueCustomers", () => {
  it("rolls bills past the grace period up per customer, most overdue money first", () => {
    const out = buildOverdueCustomers(open, TODAY);
    // INV-1 is 9 days old (within grace), INV-3 is 1 day old, undated INV skipped.
    expect(out.map((o) => o.customerId)).toEqual(["c1"]);
    const yash = out[0];
    expect(yash.bills).toBe(1);
    expect(yash.overdueCents).toBe(150_00);
    expect(yash.oldestDate).toBe("2026-07-01");
    expect(yash.maxDaysOverdue).toBe(71 - OVERDUE_GRACE_DAYS);
  });

  it("returns nothing when every bill is within grace", () => {
    expect(buildOverdueCustomers([open[0], open[2]], TODAY)).toEqual([]);
  });
});

describe("buildCustomerAging", () => {
  it("summarises open bills and the oldest date per customer", () => {
    const out = buildCustomerAging(open);
    const yash = out.find((a) => a.customerId === "c1")!;
    expect(yash.openBills).toBe(2);
    expect(yash.openCents).toBe(250_00);
    expect(yash.oldestDate).toBe("2026-07-01");
    const priya = out.find((a) => a.customerId === "c2")!;
    expect(priya.openBills).toBe(2);
    expect(priya.oldestDate).toBe("2026-09-09"); // undated bills don't move the badge
  });
});

describe("buildInvoiceTrails", () => {
  it("attaches each invoice's payments oldest-first, empty where none were taken", () => {
    const invoices = open.slice(0, 2).map((o) => ({
      id: o.id, number: o.number, issueDate: o.issueDate,
      totalCents: o.totalCents, paidCents: o.paidCents, outstandingCents: o.outstandingCents,
    }));
    const payments = [
      { id: "p2", documentId: "b", amountCents: 30_00, method: "cash", receivedAt: "2026-08-02T10:00:00+04:00" },
      { id: "p1", documentId: "b", amountCents: 20_00, method: "juice", receivedAt: "2026-07-05T10:00:00+04:00" },
      { id: "p9", documentId: "zzz", amountCents: 5_00, method: "cash", receivedAt: "2026-07-06T10:00:00+04:00" },
    ];
    const trails = buildInvoiceTrails(invoices, payments);
    expect(trails[0].payments).toEqual([]);
    expect(trails[1].payments.map((p) => p.id)).toEqual(["p1", "p2"]); // oldest first
  });
});

describe("buildOverpayments", () => {
  it("keeps only bills paid past their total, biggest excess first", () => {
    const out = buildOverpayments([
      { id: "x", number: "INV-9", customerId: "c1", customerName: "Yash", totalCents: 100_00, paidCents: 120_00 },
      { id: "y", number: "INV-10", customerId: "c2", customerName: "Priya", totalCents: 100_00, paidCents: 100_00 },
      { id: "z", number: "INV-11", customerId: "c2", customerName: "Priya", totalCents: 50_00, paidCents: 55_00 },
    ]);
    expect(out.map((o) => o.invoiceId)).toEqual(["x", "z"]);
    expect(out[0].excessCents).toBe(20_00);
    expect(out[1].excessCents).toBe(5_00);
  });
});
