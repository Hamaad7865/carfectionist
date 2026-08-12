import { describe, it, expect } from "vitest";
import { buildSalesJournal, allocate, facetsOf, saleMethodLabelFor, BACK_OFFICE, UNCATEGORISED, type JournalInput } from "./sales-journal";

// The property this report lives or dies by: EVERY section foots to the same
// pair of totals. If taxes, categories or users ever disagree with sale methods,
// the journal is wrong no matter how plausible each section looks alone.
//
// The fixture below is built to reproduce the owner's Cashmag reference period
// (28–29 July 2026) exactly — 3 tickets, 8275.70 incl, 7196.26 excl, 1079.44
// tax, 577.30 discount, cash 1980.00 / card 5195.70 / juice 1100.00,
// Anshika 6295.70 over 2 tickets, Nicolas 1980.00 over 1.

const FROM = "2026-07-28";
const TO = "2026-07-29";

const input = (over: Partial<JournalInput> = {}): JournalInput => ({
  docs: [
    // Anshika, on the till, 09:30 MU
    { id: "d1", doc_type: "invoice", business_day: FROM, total_incl: 5195.70, subtotal_excl: 4518.00, vat_total: 677.70, customer_id: null, issued_by: "u1", cash_session_id: "s1", issued_at: "2026-07-28T05:30:00Z" },
    // Anshika, back office, 14:00 MU
    { id: "d2", doc_type: "invoice", business_day: FROM, total_incl: 1100.00, subtotal_excl: 956.52, vat_total: 143.48, customer_id: null, issued_by: "u1", cash_session_id: null, issued_at: "2026-07-28T10:00:00Z" },
    // Nicolas, on the till, 17:45 MU
    { id: "d3", doc_type: "invoice", business_day: TO, total_incl: 1980.00, subtotal_excl: 1721.74, vat_total: 258.26, customer_id: null, issued_by: "u2", cash_session_id: "s1", issued_at: "2026-07-29T13:45:00Z" },
  ],
  payments: [
    { document_id: "d1", method: "card", amount: 5195.70 },
    { document_id: "d2", method: "juice", amount: 1100.00 },
    { document_id: "d3", method: "cash", amount: 1980.00 },
  ],
  lines: [
    // d1 carries the whole 577.30 discount, as per-line discount
    { document_id: "d1", qty: 2, unit_price: 1800.00, vat_rate: 15, line_total_excl: 3081.91, line_vat: 462.29, products: { name: "Cologne treatment", category: "CAR COLOGNE" } },
    { document_id: "d1", qty: 1, unit_price: 1495.30, vat_rate: 15, line_total_excl: 1436.09, line_vat: 215.41, products: { name: "Exterior wash", category: "CAR WASH EXPERTS" } },
    { document_id: "d2", qty: 1, unit_price: 956.52, vat_rate: 15, line_total_excl: 956.52, line_vat: 143.48, products: { name: "Exterior wash", category: "CAR WASH EXPERTS" } },
    { document_id: "d3", qty: 1, unit_price: 1350.00, vat_rate: 15, line_total_excl: 1350.00, line_vat: 202.50, products: { name: "Call-out", category: "SERVICES FEE" } },
    { document_id: "d3", qty: 1, unit_price: 371.74, vat_rate: 15, line_total_excl: 371.74, line_vat: 55.76, products: { name: "Exterior wash", category: "CAR WASH EXPERTS" } },
  ],
  sessionDevice: new Map([["s1", "TAB-1"]]),
  deviceName: new Map([["TAB-1", "Caisse 1"]]),
  sellerName: new Map([["u1", "Anshika"], ["u2", "Nicolas"]]),
  saleMethodLabel: saleMethodLabelFor("Carfectionist"),
  ...over,
});

const J = (over: Partial<JournalInput> = {}) => buildSalesJournal(FROM, TO, input(over));

/** The invariant, as an assertion — reused by every scenario below. */
function expectFooting(j: ReturnType<typeof J>) {
  const sum = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((a, r) => a + pick(r), 0);
  expect(sum(j.saleMethods, (r) => r.exclCents)).toBe(j.totalExclCents);
  expect(sum(j.saleMethods, (r) => r.inclCents)).toBe(j.totalInclCents);
  expect(sum(j.taxes, (r) => r.exclCents)).toBe(j.totalExclCents);
  expect(sum(j.taxes, (r) => r.inclCents)).toBe(j.totalInclCents);
  expect(sum(j.taxes, (r) => r.taxCents)).toBe(j.vatCents);
  expect(sum(j.categories, (r) => r.exclCents)).toBe(j.totalExclCents);
  expect(sum(j.categories, (r) => r.inclCents)).toBe(j.totalInclCents);
  expect(sum(j.users, (r) => r.exclCents)).toBe(j.totalExclCents);
  expect(sum(j.users, (r) => r.inclCents)).toBe(j.totalInclCents);
  expect(j.paymentsTotalCents).toBe(j.totalInclCents);
}

describe("allocate", () => {
  it("splits proportionally and sums to exactly the total", () => {
    expect(allocate(1000, [1, 1])).toEqual([500, 500]);
    expect(allocate(999, [1, 1])).toEqual([500, 499]); // the odd cent goes somewhere, not nowhere
  });

  it("never invents or loses a cent, however awkward the weights", () => {
    for (const total of [100, 9999, 123_457, -5_000]) {
      const parts = allocate(total, [7, 11, 13, 17]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("falls back to an even split when every weight is zero", () => {
    expect(allocate(300, [0, 0, 0])).toEqual([100, 100, 100]);
    expect(allocate(100, [0, 0, 0]).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("handles a single line and an empty document", () => {
    expect(allocate(4_518_00, [9_999])).toEqual([451_800]);
    expect(allocate(500, [])).toEqual([]);
  });
});

describe("sales journal — the reference period", () => {
  it("reproduces the KPI tiles", () => {
    const j = J();
    expect(j.tickets).toBe(3);
    expect(j.totalInclCents).toBe(827_570);
    expect(j.totalExclCents).toBe(719_626);
    expect(j.vatCents).toBe(107_944);
    expect(j.avgInclCents).toBe(275_857); // 8275.70 / 3 → Cashmag's "Moy : 2758,57"
  });

  it("counts clients distinctly, and reports zero for a period of walk-ins", () => {
    expect(J().clients).toBe(0);
    expect(J().clientInclCents).toBe(0);
    expect(J().clientAvgInclCents).toBe(0); // and never divides by zero
  });

  it("reports ONE sale method — the shop, not a row per till", () => {
    // Cashmag prints a single "SALES [CAFECTIONIST]" line, and so do we: the
    // owner reads a job invoiced at the desk and a wash rung on a tablet as the
    // same thing. Per-till figures live in Daily Summary, for cash-up.
    const j = J();
    expect(j.saleMethods).toHaveLength(1);
    expect(j.saleMethods[0]).toEqual({ label: "SALES [CARFECTIONIST]", tickets: 3, exclCents: 719_626, inclCents: 827_570 });
  });

  it("the sale-method row restates the period totals exactly", () => {
    const j = J();
    expect(j.saleMethods[0].tickets).toBe(j.tickets);
    expect(j.saleMethods[0].exclCents).toBe(j.totalExclCents);
    expect(j.saleMethods[0].inclCents).toBe(j.totalInclCents);
  });

  it("falls back to a plain label when no trading name is supplied", () => {
    const j = buildSalesJournal(FROM, TO, { ...input(), saleMethodLabel: undefined });
    expect(j.saleMethods[0].label).toBe("SALES");
  });

  it("reports the tax band with its discount", () => {
    const [t] = J().taxes;
    expect(t).toMatchObject({ label: "Standard rate", ratePct: 15, taxCents: 107_944, exclCents: 719_626, inclCents: 827_570 });
    expect(t.discountCents).toBe(57_730); // 577.30 — Cashmag's Remise column
  });

  it("lists payments in method order, not by value", () => {
    const j = J();
    expect(j.payments.map((p) => p.method)).toEqual(["cash", "card", "juice"]);
    expect(j.payments.map((p) => p.cents)).toEqual([198_000, 519_570, 110_000]);
    expect(j.payments.every((p) => p.n === 1)).toBe(true);
  });

  it("breaks down categories by value, with each one's share of ex-VAT", () => {
    const j = J();
    expect(j.categories.map((c) => c.label)).toEqual(["CAR COLOGNE", "CAR WASH EXPERTS", "SERVICES FEE"]);
    expect(j.categories.map((c) => c.exclCents)).toEqual([308_191, 276_435, 135_000]);
    expect(j.categories.map((c) => c.inclCents)).toEqual([354_420, 317_900, 155_250]);
    expect(j.categories.map((c) => c.pct.toFixed(2))).toEqual(["42.83", "38.41", "18.76"]);
  });

  it("attributes each ticket to the user who issued it", () => {
    const j = J();
    expect(j.users).toEqual([
      { label: "Anshika", tickets: 2, exclCents: 547_452, inclCents: 629_570 },
      { label: "Nicolas", tickets: 1, exclCents: 172_174, inclCents: 198_000 },
    ]);
  });

  it("foots across every section", () => {
    expectFooting(J());
  });
});

describe("sales journal — whole-sale discount", () => {
  // The document is worth less than the sum of its lines: an order-level
  // discount. Summing raw line totals here would overstate taxes and categories
  // by 200.00 and break the footing against sale methods.
  const overridden: Partial<JournalInput> = {
    docs: [
      { id: "x", doc_type: "invoice", business_day: FROM, total_incl: 920.00, subtotal_excl: 800.00, vat_total: 120.00, customer_id: "c1", issued_by: "u1", cash_session_id: null, issued_at: null },
    ],
    payments: [{ document_id: "x", method: "cash", amount: 920.00 }],
    lines: [
      { document_id: "x", qty: 1, unit_price: 700.00, vat_rate: 15, line_total_excl: 700.00, line_vat: 105.00, products: { name: "Polish", category: "DETAILING" } },
      { document_id: "x", qty: 1, unit_price: 300.00, vat_rate: 15, line_total_excl: 300.00, line_vat: 45.00, products: { name: "Wax", category: "PROTECTION" } },
    ],
  };

  it("scales the lines down to the document, pro-rata", () => {
    const j = buildSalesJournal(FROM, TO, input(overridden));
    // 800.00 split 700:300 → 560.00 / 240.00
    expect(j.categories.map((c) => c.exclCents)).toEqual([56_000, 24_000]);
    expect(j.categories.map((c) => c.inclCents)).toEqual([64_400, 27_600]);
  });

  it("still foots, and counts the whole-sale discount", () => {
    const j = buildSalesJournal(FROM, TO, input(overridden));
    expectFooting(j);
    expect(j.taxes[0].discountCents).toBe(20_000); // 1000.00 gross − 800.00 net
  });

  it("survives a document discounted to nothing", () => {
    const j = buildSalesJournal(FROM, TO, input({
      ...overridden,
      docs: [{ ...overridden.docs![0], total_incl: 0, subtotal_excl: 0, vat_total: 0 }],
      payments: [],
    }));
    expectFooting(j);
    expect(j.totalInclCents).toBe(0);
    expect(j.taxes[0].discountCents).toBe(100_000); // the whole list price was given away
  });

  it("does NOT invent a discount for a price_includes_vat line sold at list", () => {
    // The dash cam: unit_price IS the Rs 9,900 gross, extracted to 8,608.70 net + 1,291.30 VAT,
    // sold with NO discount. The list basis must extract VAT too, or gross−excl = the VAT and the
    // Remise column shows a phantom Rs 1,291.30 that nobody gave away (20260812000030).
    const j = buildSalesJournal(FROM, TO, input({
      docs: [{ id: "dc", doc_type: "invoice", business_day: FROM, total_incl: 9900.00, subtotal_excl: 8608.70, vat_total: 1291.30, customer_id: "c1", issued_by: "u1", cash_session_id: null, issued_at: null }],
      payments: [{ document_id: "dc", method: "cash", amount: 9900.00 }],
      lines: [
        { document_id: "dc", qty: 1, unit_price: 9900.00, vat_rate: 15, line_total_excl: 8608.70, line_vat: 1291.30, price_includes_vat: true, products: { name: "Dash Cam", category: "DASHCAM" } },
      ],
    }));
    expectFooting(j);
    expect(j.taxes[0].discountCents).toBe(0); // was 129130 (the VAT) before the flag was honoured
  });
});

describe("sales journal — credit notes", () => {
  const withCredit = () =>
    buildSalesJournal(FROM, TO, input({
      docs: [
        ...input().docs,
        { id: "cn", doc_type: "credit_note", business_day: TO, total_incl: 1100.00, subtotal_excl: 956.52, vat_total: 143.48, customer_id: null, issued_by: "u1", cash_session_id: null, issued_at: null },
      ],
      lines: [
        ...input().lines,
        { document_id: "cn", qty: 1, unit_price: 956.52, vat_rate: 15, line_total_excl: 956.52, line_vat: 143.48, products: { name: "Exterior wash", category: "CAR WASH EXPERTS" } },
      ],
    }));

  it("nets the period DOWN and is not counted as a ticket", () => {
    const j = withCredit();
    expect(j.tickets).toBe(3); // still 3 — a credit note reduces money, it is not a sale
    expect(j.totalInclCents).toBe(827_570 - 110_000);
    expect(j.totalExclCents).toBe(719_626 - 95_652);
  });

  it("reverses the category it was raised against, and still foots", () => {
    const j = withCredit();
    const wash = j.categories.find((c) => c.label === "CAR WASH EXPERTS")!;
    expect(wash.exclCents).toBe(276_435 - 95_652);
    expect(wash.qty).toBe(2); // 3 sold, 1 returned
    expectFooting(j);
  });
});

describe("sales journal — payments vs credit sales", () => {
  it("equals the takings when every ticket was settled", () => {
    const j = J();
    expect(j.paymentsSubtotalCents).toBe(827_570);
    expect(j.paymentsTotalCents).toBe(827_570);
  });

  it("S/TOTAL falls below Total when a ticket is delivered on account", () => {
    // d3 goes home unpaid — the money is owed, not tendered.
    const j = J({ payments: input().payments.filter((p) => p.document_id !== "d3") });
    expect(j.paymentsSubtotalCents).toBe(827_570 - 198_000);
    expect(j.paymentsTotalCents).toBe(827_570); // the period still sold 8275.70
    expect(j.paymentsSubtotalCents).toBeLessThan(j.paymentsTotalCents);
    expectFooting(j);
  });
});

describe("sales journal — filters", () => {
  it("narrows to one till, and the narrowed period still foots", () => {
    // The till is a FILTER, not a row: the section still shows the one shop
    // method, now carrying only what that till rang.
    const j = J({ filters: { device: "Caisse 1" } });
    expect(j.tickets).toBe(2);
    expect(j.totalInclCents).toBe(717_570); // d1 + d3
    expect(j.saleMethods).toHaveLength(1);
    expect(j.saleMethods[0]).toMatchObject({ label: "SALES [CARFECTIONIST]", tickets: 2, inclCents: 717_570 });
    expectFooting(j);
  });

  it("still offers Back office as a device to filter to", () => {
    const j = J({ filters: { device: BACK_OFFICE } });
    expect(j.tickets).toBe(1);
    expect(j.totalInclCents).toBe(110_000); // d2, invoiced off the till
    expectFooting(j);
  });

  it("narrows to one user", () => {
    const j = J({ filters: { user: "Nicolas" } });
    expect(j.tickets).toBe(1);
    expect(j.totalInclCents).toBe(198_000);
    expectFooting(j);
  });

  it("keeps whole tickets CONTAINING a service, not just that service's lines", () => {
    // d3 contains the call-out; its wash line comes along, because a ticket is
    // in or out. Filtering to lines would leave sale methods disagreeing.
    const j = J({ filters: { service: "Call-out" } });
    expect(j.tickets).toBe(1);
    expect(j.totalInclCents).toBe(198_000);
    expect(j.categories.map((c) => c.label).sort()).toEqual(["CAR WASH EXPERTS", "SERVICES FEE"]);
    expectFooting(j);
  });

  it("narrows by time of day, in Mauritius time", () => {
    // d1 at 09:30, d2 at 14:00, d3 at 17:45 MU
    expect(J({ filters: { timeFrom: "12:00", timeTo: "23:59" } }).tickets).toBe(2);
    expect(J({ filters: { timeFrom: "00:00", timeTo: "12:00" } }).tickets).toBe(1);
    expect(J({ filters: { timeFrom: "15:00", timeTo: "18:00" } }).totalInclCents).toBe(198_000);
    expectFooting(J({ filters: { timeFrom: "12:00", timeTo: "23:59" } }));
  });

  it("combines filters", () => {
    expect(J({ filters: { device: "Caisse 1", user: "Anshika" } }).tickets).toBe(1);
    expect(J({ filters: { device: "Caisse 1", user: "Anshika" } }).totalInclCents).toBe(519_570);
  });

  it("returns an empty journal when nothing matches", () => {
    const j = J({ filters: { user: "Nobody" } });
    expect(j.tickets).toBe(0);
    expect(j.totalInclCents).toBe(0);
    expect(j.saleMethods).toEqual([]);
    expect(j.categories).toEqual([]);
  });
});

describe("sales journal — edges", () => {
  it("returns a zeroed journal for a period with no documents", () => {
    const j = buildSalesJournal(FROM, TO, input({ docs: [], payments: [], lines: [] }));
    expect(j).toMatchObject({ tickets: 0, totalInclCents: 0, avgInclCents: 0, clients: 0 });
    expect(j.taxes).toEqual([]);
    expect(j.payments).toEqual([]);
  });

  it("files a line with no product under (uncategorised)", () => {
    const j = J({
      lines: [{ document_id: "d1", title: "Custom polish", qty: 1, unit_price: 4518.00, vat_rate: 15, line_total_excl: 4518.00, line_vat: 677.70, products: null }],
      docs: input().docs.filter((d) => d.id === "d1"),
      payments: [],
    });
    expect(j.categories.map((c) => c.label)).toEqual([UNCATEGORISED]);
    expectFooting(j);
  });

  it("separates tax bands and orders them by rate", () => {
    const j = J({
      docs: [{ id: "z", doc_type: "invoice", business_day: FROM, total_incl: 1150.00, subtotal_excl: 1100.00, vat_total: 50.00, customer_id: null, issued_by: "u1", cash_session_id: null, issued_at: null }],
      payments: [],
      lines: [
        { document_id: "z", qty: 1, unit_price: 1000.00, vat_rate: 0, line_total_excl: 1000.00, line_vat: 0, products: { name: "Exempt item", category: "OTHER" } },
        { document_id: "z", qty: 1, unit_price: 100.00, vat_rate: 15, line_total_excl: 100.00, line_vat: 15.00, products: { name: "Wax", category: "OTHER" } },
      ],
    });
    expect(j.taxes.map((t) => t.label)).toEqual(["Zero-rated", "Standard rate"]);
    expectFooting(j);
  });
});

describe("facetsOf", () => {
  it("lists the tills, items and users the period actually saw", () => {
    const f = facetsOf(input());
    expect(f.devices).toEqual([BACK_OFFICE, "Caisse 1"]);
    expect(f.users).toEqual(["Anshika", "Nicolas"]);
    expect(f.services).toEqual(["Call-out", "Cologne treatment", "Exterior wash"]);
  });
});
