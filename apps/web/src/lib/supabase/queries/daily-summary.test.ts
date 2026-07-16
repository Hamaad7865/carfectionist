import { describe, it, expect } from "vitest";
import { buildDailySummary, daysInRange, OTHER_SERVICES, type SummaryInput } from "./daily-summary";

// The money rules this report must never break:
//  • credit notes net the day DOWN
//  • a credit note is not a "ticket" (it reduces money, it isn't a sale)
//  • a day with no sales still appears, at zero
//  • the totals row equals the sum of the day rows — always
//  • incl = excl + tax, per tax band

const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  docs: [
    { id: "d1", doc_type: "invoice", business_day: "2026-07-13", total_incl: 1150, subtotal_excl: 1000, vat_total: 150, customer_id: "c1", issued_by: "u1", cash_session_id: "s1" },
    { id: "d2", doc_type: "invoice", business_day: "2026-07-13", total_incl: 575, subtotal_excl: 500, vat_total: 75, customer_id: "c2", issued_by: "u1", cash_session_id: null },
    { id: "d3", doc_type: "credit_note", business_day: "2026-07-14", total_incl: 115, subtotal_excl: 100, vat_total: 15, customer_id: "c1", issued_by: "u2", cash_session_id: null },
  ],
  payments: [
    { document_id: "d1", method: "cash", amount: 1150 },
    { document_id: "d2", method: "card", amount: 575 },
  ],
  lines: [
    { document_id: "d1", vat_rate: 15, line_total_excl: 1000, line_vat: 150, products: { name: "Full Detail", kind: "service" } },
    { document_id: "d2", vat_rate: 15, line_total_excl: 500, line_vat: 75, products: { name: "Wash", kind: "service" } },
    { document_id: "d3", vat_rate: 15, line_total_excl: 100, line_vat: 15, products: { name: "Wash", kind: "service" } },
  ],
  sessionDevice: new Map([["s1", "TAB-1"]]),
  deviceName: new Map([["TAB-1", "Caisse 1"]]),
  sellerName: new Map([["u1", "Anshika"], ["u2", "Anesh"]]),
  ...over,
});

const R = (from = "2026-07-13", to = "2026-07-15") => buildDailySummary(from, to, input());

describe("daysInRange", () => {
  it("is inclusive of both ends", () => {
    expect(daysInRange("2026-07-13", "2026-07-15")).toEqual(["2026-07-13", "2026-07-14", "2026-07-15"]);
  });
  it("returns nothing when the range is backwards", () => {
    expect(daysInRange("2026-07-15", "2026-07-13")).toEqual([]);
  });
});

describe("daily summary — the day rows", () => {
  it("sums a normal trading day", () => {
    const day = R().rows[0];
    expect(day.day).toBe("2026-07-13");
    expect(day.tickets).toBe(2);
    expect(day.totalInclCents).toBe(172_500); // 1150 + 575
    expect(day.totalExclCents).toBe(150_000);
    expect(day.vatCents).toBe(22_500);
    expect(day.clients).toBe(2);
  });

  it("averages per ticket", () => {
    const day = R().rows[0];
    expect(day.avgInclCents).toBe(86_250); // 172500 / 2
    expect(day.avgExclCents).toBe(75_000);
  });

  it("a credit note nets the day DOWN and is not counted as a ticket", () => {
    const day = R().rows[1]; // 2026-07-14 — the credit-note day
    expect(day.tickets).toBe(0);
    expect(day.totalInclCents).toBe(-11_500);
    expect(day.totalExclCents).toBe(-10_000);
    expect(day.vatCents).toBe(-1_500);
  });

  it("a day with no sales still appears, at zero", () => {
    const day = R().rows[2]; // 2026-07-15
    expect(day.day).toBe("2026-07-15");
    expect(day.tickets).toBe(0);
    expect(day.totalInclCents).toBe(0);
    expect(day.avgInclCents).toBe(0); // and never divides by zero
  });
});

describe("daily summary — breakdowns", () => {
  it("splits sale methods by till, and calls a session-less sale Back office", () => {
    const day = R().rows[0];
    expect(day.byDevice["Caisse 1"]).toEqual({ cents: 115_000, n: 1 });
    expect(day.byDevice["Back office"]).toEqual({ cents: 57_500, n: 1 });
  });

  it("groups payments by method against the ticket's day", () => {
    const day = R().rows[0];
    expect(day.byMethod.cash).toEqual({ cents: 115_000, n: 1 });
    expect(day.byMethod.card).toEqual({ cents: 57_500, n: 1 });
    // and the day's payments reconcile to the day's takings
    const paid = Object.values(day.byMethod).reduce((s, b) => s + b.cents, 0);
    expect(paid).toBe(day.totalInclCents);
  });

  it("tax band: incl = excl + tax", () => {
    const t = R().rows[0].byTax["15%"];
    expect(t.exclCents).toBe(150_000);
    expect(t.taxCents).toBe(22_500);
    expect(t.inclCents).toBe(t.exclCents + t.taxCents);
  });

  it("attributes revenue to the seller who issued it", () => {
    expect(R().rows[0].bySeller.Anshika).toEqual({ cents: 172_500, n: 2 });
    expect(R().rows[1].bySeller.Anesh.cents).toBe(-11_500); // the credit note
  });

  it("counts a service's tickets by document, not by line", () => {
    const day = R().rows[0];
    expect(day.byService["Full Detail"]).toEqual({ cents: 115_000, n: 1 });
    expect(day.byService.Wash).toEqual({ cents: 57_500, n: 1 });
  });
});

describe("daily summary — the totals row", () => {
  it("equals the sum of the day rows", () => {
    const { rows, totals } = R();
    expect(totals.tickets).toBe(rows.reduce((s, r) => s + r.tickets, 0));
    expect(totals.totalInclCents).toBe(rows.reduce((s, r) => s + r.totalInclCents, 0));
    expect(totals.totalExclCents).toBe(rows.reduce((s, r) => s + r.totalExclCents, 0));
    expect(totals.vatCents).toBe(rows.reduce((s, r) => s + r.vatCents, 0));
    expect(totals.totalInclCents).toBe(161_000); // 172500 − 11500
  });

  it("counts clients distinctly across the period, not by summing days", () => {
    // c1 buys on both days — the period must say 2 customers, not 3
    expect(R().totals.clients).toBe(2);
  });

  it("nets a service across the period", () => {
    expect(R().totals.byService.Wash.cents).toBe(46_000); // 57500 − 11500
  });
});

describe("daily summary — column discovery", () => {
  it("only lists what actually occurred, ranked by revenue", () => {
    const s = R();
    expect(s.services).toEqual(["Full Detail", "Wash"]); // ranked, nothing that did not sell
    expect(s.methods).toEqual(["cash", "card"]);
    expect(s.taxes).toEqual(["15%"]);
    expect(s.sellers).toEqual(["Anshika", "Anesh"]);
  });

  it("folds everything past the top 15 into Other items, and still reconciles", () => {
    // 20 services on one invoice, descending value
    const docs: SummaryInput["docs"] = [
      { id: "x", doc_type: "invoice", business_day: "2026-07-13", total_incl: 2300, subtotal_excl: 2000, vat_total: 300, customer_id: "c1", issued_by: "u1", cash_session_id: null },
    ];
    const lines: SummaryInput["lines"] = Array.from({ length: 20 }, (_, i) => ({
      document_id: "x", vat_rate: 15, line_total_excl: 100 * (20 - i), line_vat: 15 * (20 - i),
      products: { name: `S${i}`, kind: "service" },
    }));
    const s = buildDailySummary("2026-07-13", "2026-07-13", input({ docs, lines, payments: [] }));
    expect(s.services).toHaveLength(16); // 15 + Other
    expect(s.services[15]).toBe(OTHER_SERVICES);
    // nothing is lost in the fold: the service columns still sum to the day's service revenue
    const day = s.rows[0];
    const summed = Object.values(day.byService).reduce((a, b) => a + b.cents, 0);
    const expected = lines.reduce((a, l) => a + (Number(l.line_total_excl) + Number(l.line_vat)) * 100, 0);
    expect(summed).toBe(expected);
  });

  it("counts PRODUCTS too — most of a detailing day is products, not services", () => {
    const s = buildDailySummary("2026-07-13", "2026-07-13", input({
      lines: [{ document_id: "d1", vat_rate: 15, line_total_excl: 1000, line_vat: 150, products: { name: "Shampoo", kind: "product" } }],
    }));
    expect(s.services).toEqual(["Shampoo"]);
    expect(s.rows[0].byService.Shampoo.cents).toBe(115_000);
    expect(s.rows[0].byTax["15%"].exclCents).toBe(100_000);
  });

  it("names an ad-hoc line by its title, so typed work is never invisible", () => {
    const s = buildDailySummary("2026-07-13", "2026-07-13", input({
      lines: [{ document_id: "d1", title: "Custom polish", vat_rate: 15, line_total_excl: 1000, line_vat: 150, products: null }],
    }));
    expect(s.services).toEqual(["Custom polish"]);
    expect(s.rows[0].byService["Custom polish"].cents).toBe(115_000);
  });

  it("falls back to a placeholder when a line has neither product nor title", () => {
    const s = buildDailySummary("2026-07-13", "2026-07-13", input({
      lines: [{ document_id: "d1", title: "  ", vat_rate: 15, line_total_excl: 100, line_vat: 15, products: null }],
    }));
    expect(s.services).toEqual(["Ad-hoc item"]);
  });

  it("the items section reconciles to the day's sales", () => {
    // every line is represented, so the item columns sum to the day's total
    const s = R();
    const day = s.rows[0];
    const items = Object.values(day.byService).reduce((a, b) => a + b.cents, 0);
    expect(items).toBe(day.totalInclCents);
  });
});

describe("daily summary — empty period", () => {
  it("returns zeroed rows and no columns", () => {
    const s = buildDailySummary("2026-07-13", "2026-07-14", input({ docs: [], payments: [], lines: [] }));
    expect(s.rows).toHaveLength(2);
    expect(s.rows.every((r) => r.tickets === 0 && r.totalInclCents === 0)).toBe(true);
    expect(s.totals.totalInclCents).toBe(0);
    expect(s.services).toEqual([]);
  });
});
