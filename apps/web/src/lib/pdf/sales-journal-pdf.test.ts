import { describe, it, expect } from "vitest";
import { toJournalTables, toJournalPdfProps, footerLine } from "./sales-journal-pdf";
import { buildSalesJournal, type JournalInput } from "@/lib/supabase/queries/sales-journal";

// The PDF is only worth anything if it says exactly what the screen says. The
// figures below are the owner's Cashmag reference period, so this doubles as a
// check that the printed journal still reconciles.

const FROM = "2026-07-28";
const TO = "2026-07-29";

const input: JournalInput = {
  docs: [
    { id: "d1", doc_type: "invoice", business_day: FROM, total_incl: 5195.70, subtotal_excl: 4518.00, vat_total: 677.70, customer_id: null, issued_by: "u1", cash_session_id: "s1", issued_at: null },
    { id: "d2", doc_type: "invoice", business_day: FROM, total_incl: 1100.00, subtotal_excl: 956.52, vat_total: 143.48, customer_id: null, issued_by: "u1", cash_session_id: null, issued_at: null },
    { id: "d3", doc_type: "invoice", business_day: TO, total_incl: 1980.00, subtotal_excl: 1721.74, vat_total: 258.26, customer_id: null, issued_by: "u2", cash_session_id: "s1", issued_at: null },
  ],
  payments: [
    { document_id: "d1", method: "card", amount: 5195.70 },
    { document_id: "d2", method: "juice", amount: 1100.00 },
    { document_id: "d3", method: "cash", amount: 1980.00 },
  ],
  lines: [
    { document_id: "d1", qty: 2, unit_price: 1800.00, vat_rate: 15, line_total_excl: 3081.91, line_vat: 462.29, products: { name: "Cologne treatment", category: "CAR COLOGNE" } },
    { document_id: "d1", qty: 1, unit_price: 1495.30, vat_rate: 15, line_total_excl: 1436.09, line_vat: 215.41, products: { name: "Exterior wash", category: "CAR WASH EXPERTS" } },
    { document_id: "d2", qty: 1, unit_price: 956.52, vat_rate: 15, line_total_excl: 956.52, line_vat: 143.48, products: { name: "Exterior wash", category: "CAR WASH EXPERTS" } },
    { document_id: "d3", qty: 1, unit_price: 1350.00, vat_rate: 15, line_total_excl: 1350.00, line_vat: 202.50, products: { name: "Call-out", category: "SERVICES FEE" } },
    { document_id: "d3", qty: 1, unit_price: 371.74, vat_rate: 15, line_total_excl: 371.74, line_vat: 55.76, products: { name: "Exterior wash", category: "CAR WASH EXPERTS" } },
  ],
  sessionDevice: new Map([["s1", "TAB-1"]]),
  deviceName: new Map([["TAB-1", "Caisse 1"]]),
  sellerName: new Map([["u1", "Anshika"], ["u2", "Nicolas"]]),
  saleMethodLabel: "SALES [CARFECTIONIST]",
};

const journal = buildSalesJournal(FROM, TO, input);
const tables = toJournalTables(journal);
const table = (title: string) => tables.find((t) => t.title === title)!;

describe("sales journal PDF — structure", () => {
  it("prints the five sections, in Cashmag's order", () => {
    expect(tables.map((t) => t.title)).toEqual(["Sale methods", "Taxes", "Payments", "Categories", "User logs"]);
  });

  it("gives every row exactly as many cells as the header has columns", () => {
    for (const t of tables) {
      const expected = t.head.length - 1; // the label column is not in `cells`
      for (const r of [...t.rows, t.total, ...(t.note ? [t.note] : [])]) {
        expect(r.cells).toHaveLength(expected);
      }
    }
  });
});

describe("sales journal PDF — the figures match the screen", () => {
  it("sale methods — one row for the shop, as Cashmag prints it", () => {
    const t = table("Sale methods");
    expect(t.rows.map((r) => [r.label, ...r.cells])).toEqual([
      ["SALES [CARFECTIONIST]", "3", "Rs 7,196.26", "Rs 8,275.70"],
    ]);
    expect(t.total.cells).toEqual(["3", "Rs 7,196.26", "Rs 8,275.70"]);
  });

  it("taxes, with the discount column", () => {
    const t = table("Taxes");
    expect(t.rows[0].cells).toEqual(["15%", "Rs 1,079.44", "Rs 577.30", "Rs 7,196.26", "Rs 8,275.70"]);
    expect(t.total.cells).toEqual([null, "Rs 1,079.44", "Rs 577.30", "Rs 7,196.26", "Rs 8,275.70"]);
  });

  it("payments, with the excl-credits subtotal", () => {
    const t = table("Payments");
    expect(t.rows.map((r) => [r.label, ...r.cells])).toEqual([
      ["Cash", "1", "Rs 1,980.00"],
      ["Bank card", "1", "Rs 5,195.70"],
      ["Juice", "1", "Rs 1,100.00"],
    ]);
    expect(t.note!.cells).toEqual([null, "Rs 8,275.70"]);
    expect(t.total.cells).toEqual([null, "Rs 8,275.70"]);
  });

  it("categories, with each share of ex-VAT", () => {
    const t = table("Categories");
    expect(t.rows.map((r) => [r.label, ...r.cells])).toEqual([
      ["CAR COLOGNE", "2", "42.83%", "Rs 3,081.91", "Rs 3,544.20"],
      ["CAR WASH EXPERTS", "3", "38.41%", "Rs 2,764.35", "Rs 3,179.00"],
      ["SERVICES FEE", "1", "18.76%", "Rs 1,350.00", "Rs 1,552.50"],
    ]);
  });

  it("user logs", () => {
    const t = table("User logs");
    expect(t.rows.map((r) => [r.label, ...r.cells])).toEqual([
      ["Anshika", "2", "Rs 5,474.52", "Rs 6,295.70"],
      ["Nicolas", "1", "Rs 1,721.74", "Rs 1,980.00"],
    ]);
  });

  it("every section's printed total is the SAME total", () => {
    const incl = tables.map((t) => t.total.cells[t.total.cells.length - 1]);
    expect(new Set(incl)).toEqual(new Set(["Rs 8,275.70"]));
  });
});

describe("sales journal PDF — the header block", () => {
  it("carries the KPI tiles", () => {
    const p = toJournalPdfProps(journal, "CARFECTIONIST");
    expect(p.periodLabel).toBe("28 JULY 2026 – 29 JULY 2026");
    expect(p.tickets).toBe(3);
    expect(p.totalInclLabel).toBe("Rs 8,275.70");
    expect(p.avgLabel).toBe("Avg Rs 2,758.57");
    expect(p.clients).toBe(0);
    expect(p.comparedWith).toBeNull();
  });

  it("names the comparison period when one is set", () => {
    const p = toJournalPdfProps(journal, "CARFECTIONIST", { from: "2026-07-26", to: "2026-07-27" });
    expect(p.comparedWith).toBe("26 Jul – 27 Jul 2026");
  });
});

describe("sales journal PDF — the running footer", () => {
  it("reads like Cashmag's 'Édité le …', in Mauritius time", () => {
    expect(footerLine("2026-07-29T08:00:00Z")).toBe("Generated on Wednesday 29 July 2026");
  });

  it("uses the Mauritius calendar day, not UTC's", () => {
    // 22:30 UTC is already the next morning in Mauritius (UTC+4).
    expect(footerLine("2026-07-29T22:30:00Z")).toBe("Generated on Thursday 30 July 2026");
  });
});
