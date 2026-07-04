import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentA4, type DocumentA4Props } from "./DocumentA4";

const base: DocumentA4Props = {
  docType: "quote",
  number: "A00116",
  issueDate: "2026-07-04",
  createdBy: "Rakesh",
  from: {
    tradingName: "Carfectionist",
    legalName: "Diamondbrite Reunion (Mauritius) Ltd",
    country: "Mauritius",
    brn: "C22190760",
    email: "carfectionist@gmail.com",
    phone: "+230 5258 8854",
    vatNo: "VAT28070619",
  },
  billTo: { name: "Jean-Pierre Laval", country: "Mauritius" },
  lines: [
    { title: "Full Decontamination & Body Polish", qty: 1, rateCents: 3200000, amountCents: 3200000 },
    { title: "Remove Wheel, Decontamination & Polish", qty: 4, rateCents: 380000, amountCents: 1520000 },
    { title: "Diamondbrite 3-Year Protection (Exterior Only)", qty: 1, rateCents: 3000000, amountCents: 3000000 },
  ],
  subtotalCents: 7720000,
  vatCents: 1158000,
  totalCents: 8878000,
  bank: { accountName: "Diamondbrite Reunion (Mauritius) Ltd", accountNumber: "000449884716", bankName: "MCB" },
  terms: ["Quotation is valid for 5 days."],
};

describe("DocumentA4 — reproduces the Diamondbrite Rs 88,780 document", () => {
  const html = renderToStaticMarkup(<DocumentA4 {...base} />);

  it("renders the correct title and number", () => {
    expect(html).toContain("Quotation");
    expect(html).toContain("A00116");
  });

  it("renders the exact column headers", () => {
    for (const col of ["Item", "Quantity", "Rate", "Amount"]) expect(html).toContain(col);
  });

  it("renders the money totals exactly", () => {
    expect(html).toContain("Rs 77,200.00");
    expect(html).toContain("Rs 11,580.00");
    expect(html).toContain("Rs 88,780.00");
  });

  it("renders the amount in words", () => {
    expect(html).toContain("EIGHTY EIGHT THOUSAND SEVEN HUNDRED EIGHTY RUPEES ONLY");
  });

  it("renders the legal identity, customer, bank and terms", () => {
    expect(html).toContain("Diamondbrite Reunion (Mauritius) Ltd");
    expect(html).toContain("C22190760");
    expect(html).toContain("VAT28070619");
    expect(html).toContain("Jean-Pierre Laval");
    expect(html).toContain("MCB");
    expect(html).toContain("Quotation is valid for 5 days.");
  });
});

describe("DocumentA4 — invoice fiscal lock", () => {
  it("keeps the legal identity even when config tries to hide it", () => {
    const html = renderToStaticMarkup(
      <DocumentA4 {...base} docType="invoice" number="INV-0001" sectionConfig={{ from: false }} />,
    );
    expect(html).toContain("Invoice");
    expect(html).toContain("Diamondbrite Reunion (Mauritius) Ltd");
    expect(html).toContain("VAT28070619");
  });
});
