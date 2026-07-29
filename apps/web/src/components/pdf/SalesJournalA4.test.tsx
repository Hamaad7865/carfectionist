import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SalesJournalA4 } from "./SalesJournalA4";
import { toJournalPdfProps } from "@/lib/pdf/sales-journal-pdf";
import { buildSalesJournal, type JournalInput } from "@/lib/supabase/queries/sales-journal";

// The PDF is rendered by a headless browser we cannot run in a unit test, so the
// closest useful check is the markup it is handed: it renders without throwing,
// every section is present, and the figures the owner reads are actually in it.

const input: JournalInput = {
  docs: [
    { id: "d1", doc_type: "invoice", business_day: "2026-07-28", total_incl: 5195.70, subtotal_excl: 4518.00, vat_total: 677.70, customer_id: "c1", issued_by: "u1", cash_session_id: "s1", issued_at: null },
    { id: "d2", doc_type: "invoice", business_day: "2026-07-29", total_incl: 1980.00, subtotal_excl: 1721.74, vat_total: 258.26, customer_id: null, issued_by: "u2", cash_session_id: null, issued_at: null },
  ],
  payments: [{ document_id: "d1", method: "card", amount: 5195.70 }],
  lines: [
    { document_id: "d1", qty: 2, unit_price: 1800.00, vat_rate: 15, line_total_excl: 3081.91, line_vat: 462.29, products: { name: "Cologne treatment", category: "CAR COLOGNE" } },
    { document_id: "d1", qty: 1, unit_price: 1495.30, vat_rate: 15, line_total_excl: 1436.09, line_vat: 215.41, products: { name: "Exterior wash", category: "CAR WASH EXPERTS" } },
    { document_id: "d2", qty: 1, unit_price: 1721.74, vat_rate: 15, line_total_excl: 1721.74, line_vat: 258.26, products: { name: "Call-out", category: "SERVICES FEE" } },
  ],
  sessionDevice: new Map([["s1", "TAB-1"]]),
  deviceName: new Map([["TAB-1", "Caisse 1"]]),
  sellerName: new Map([["u1", "Anshika"], ["u2", "Nicolas"]]),
};

const journal = buildSalesJournal("2026-07-28", "2026-07-29", input);
const html = renderToStaticMarkup(<SalesJournalA4 {...toJournalPdfProps(journal, "CARFECTIONIST")} />);

describe("SalesJournalA4", () => {
  it("heads the page with the shop and the period", () => {
    expect(html).toContain("CARFECTIONIST");
    expect(html).toContain("Sales Journal");
    expect(html).toContain("28 JULY 2026 – 29 JULY 2026");
  });

  it("prints all five sections, in order", () => {
    const at = (s: string) => html.indexOf(s);
    const order = ["Sale methods", "Taxes", "Payments", "Categories", "User logs"].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("carries the KPI figures", () => {
    expect(html).toContain("Rs 7,175.70"); // total incl
    expect(html).toContain("Avg Rs 3,587.85");
  });

  it("shows the unpaid balance as the gap between tendered and takings", () => {
    // d2 went out on account: Rs 5,195.70 tendered against Rs 7,175.70 sold.
    expect(html).toContain("Subtotal (excl credits)");
    expect(html).toContain("Rs 5,195.70");
  });

  it("builds real table markup — one cell per column, on every row", () => {
    // A mismatched row would silently shift a money column under the wrong head.
    const tables = html.match(/<table[\s\S]*?<\/table>/g) ?? [];
    expect(tables).toHaveLength(5);
    const bad: string[] = [];
    tables.forEach((t, i) => {
      // `<th[ >]`, not `<th` — the latter also matches <thead> and inflates the count.
      const cols = (t.match(/<th[ >]/g) ?? []).length;
      for (const row of t.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
        const cells = (row.match(/<t[dh][ >]/g) ?? []).length;
        if (cells !== cols) bad.push(`table ${i}: ${cells} cells vs ${cols} cols — ${row.replace(/ style="[^"]*"/g, "").slice(0, 200)}`);
      }
    });
    expect(bad).toEqual([]);
  });

  it("renders an empty period without throwing", () => {
    const blank = buildSalesJournal("2026-07-28", "2026-07-29", { ...input, docs: [], payments: [], lines: [] });
    const out = renderToStaticMarkup(<SalesJournalA4 {...toJournalPdfProps(blank, "CARFECTIONIST")} />);
    expect(out).toContain("Nothing in this period.");
    expect(out).toContain("Rs 0.00");
  });
});
