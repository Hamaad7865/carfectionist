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

  it("renders MUR-prefixed money — VAT, total and line amounts", () => {
    expect(html).toContain("MUR 11,580.00"); // VAT
    expect(html).toContain("MUR 88,780.00"); // Total (MUR)
    expect(html).toContain("MUR 32,000.00"); // line amount
    expect(html).toContain("MUR 30,000.00");
  });

  it("renders subtotal before VAT and total even without a discount", () => {
    const subtotalAt = html.indexOf(">Subtotal<");
    const vatAt = html.indexOf(">VAT<");
    const totalAt = html.indexOf(">Total (MUR)<");

    expect(subtotalAt).toBeGreaterThan(-1);
    expect(html).toContain("MUR 77,200.00");
    expect(subtotalAt).toBeLessThan(vatAt);
    expect(vatAt).toBeLessThan(totalAt);
  });

  it("trims the whole-rupee rate (MUR 32,000, not MUR 32,000.00)", () => {
    expect(html).toContain(">MUR 32,000<");
  });

  it("renders the amount in words", () => {
    expect(html).toContain("EIGHTY EIGHT THOUSAND SEVEN HUNDRED EIGHTY RUPEES ONLY");
  });

  it("renders the identity, customer, bank, terms and disclaimer", () => {
    expect(html).toContain("C22190760");
    expect(html).toContain("VAT28070619");
    expect(html).toContain("Jean-Pierre Laval");
    expect(html).toContain("Diamondbrite Reunion (Mauritius) Ltd"); // bank account name
    expect(html).toContain("MCB");
    expect(html).toContain("Quotation is valid for 5 days.");
    expect(html).toContain("This is an electronically generated document, no signature is required.");
  });

  it("carries the Diamondbrite artwork by default", () => {
    expect(html).toContain("/brand/covered-by-diamonds.png");
    expect(html).toContain("/brand/diamondbrite-forever.png");
    expect(html).toContain("/brand/diamondbrite-logo.png");
  });
});

describe("DocumentA4 — invoice fiscal lock", () => {
  it("keeps the tax identity (BRN + VAT) even when config tries to hide the From box", () => {
    const html = renderToStaticMarkup(
      <DocumentA4 {...base} docType="invoice" number="INV-0001" sectionConfig={{ from: false }} />,
    );
    expect(html).toContain("Invoice");
    expect(html).toContain("C22190760");
    expect(html).toContain("VAT28070619");
  });
});

describe("DocumentA4 — a business client's fiscal identity", () => {
  it("prints the client's BRN and VAT number in the For box", () => {
    const html = renderToStaticMarkup(
      <DocumentA4 {...base} billTo={{ name: "ACME Ltd", country: "Mauritius", brn: "C99887766", vatNo: "VAT55667788" }} />,
    );
    expect(html).toContain("C99887766");
    expect(html).toContain("VAT55667788");
  });

  it("leaves the For box as name + country for an individual with neither", () => {
    const html = renderToStaticMarkup(
      <DocumentA4 {...base} billTo={{ name: "Jean-Pierre Laval", country: "Mauritius" }} />,
    );
    // The client half never invents a label the client doesn't have a value for.
    const forBox = html.slice(html.indexOf("Jean-Pierre Laval"));
    expect(forBox).not.toContain("BRN:");
    expect(forBox).not.toContain("VAT NUMBER:");
  });
});

describe("DocumentA4 — client acceptance stamp", () => {
  it("renders the signature block when accepted", () => {
    const html = renderToStaticMarkup(
      <DocumentA4 {...base} accepted={{ name: "ANESH", at: "13 Jul 2026, 14:31", signatureUrl: "https://x/sig.png" }} />,
    );
    expect(html).toContain("Accepted by the client");
    expect(html).toContain("ANESH");
    expect(html).toContain("https://x/sig.png");
  });
  it("omits the block entirely when not accepted", () => {
    const html = renderToStaticMarkup(<DocumentA4 {...base} />);
    expect(html).not.toContain("Accepted by the client");
  });
});

describe("DocumentA4 — a line that explains itself", () => {
  // The line this whole feature exists for: a Rs 30,434.78 price with the four
  // bullets underneath that justify it.
  const diamondbrite = {
    schemaVersion: 1 as const,
    blocks: [
      {
        type: "ul" as const,
        items: [
          [{ text: "Full Vehicle decontamination" }],
          [{ text: "Paint Correction ( 1 - 5 Step polishing depending on surface damages)" }],
          [{ text: "Ceramic Coating 3 years protection on body only" }],
          [{ text: "Plastic treatment and restoration" }],
        ],
      },
    ],
  };

  it("prints the bullets as a real list under the title", () => {
    const html = renderToStaticMarkup(
      <DocumentA4
        {...base}
        lines={[{ title: "Diamondbrite 3 YEARS PROTECTION Exterior only", qty: 1, rateCents: 3043478, amountCents: 3043478, rich: diamondbrite }]}
      />,
    );
    expect(html).toContain("<ul");
    // Inside list items, not run together in one pre-wrap blob. (Counting every
    // <li on the page would also catch the terms list at the foot of the document.)
    expect(html).toContain("Full Vehicle decontamination</li>");
    expect(html).toContain("Paint Correction ( 1 - 5 Step polishing depending on surface damages)</li>");
    expect(html).toContain("Ceramic Coating 3 years protection on body only</li>");
    expect(html).toContain("Plastic treatment and restoration</li>");
  });

  it("still prints a plain detail for a line saved before rich content existed", () => {
    const html = renderToStaticMarkup(
      <DocumentA4 {...base} lines={[{ title: "Wash", qty: 1, rateCents: 30000, amountCents: 30000, detail: "Exterior only" }]} />,
    );
    expect(html).toContain("Exterior only");
  });

  it("prefers the tree over the flat mirror when a line carries both", () => {
    const html = renderToStaticMarkup(
      <DocumentA4
        {...base}
        lines={[{ title: "X", qty: 1, rateCents: 100, amountCents: 100, detail: "flat mirror", rich: diamondbrite }]}
      />,
    );
    expect(html).toContain("Full Vehicle decontamination");
    expect(html).not.toContain("flat mirror");
  });

  it("shows the unit beside the quantity", () => {
    const html = renderToStaticMarkup(
      <DocumentA4 {...base} lines={[{ title: "Waterspot treatment", qty: 3, unit: "panels", rateCents: 100000, amountCents: 300000 }]} />,
    );
    expect(html).toContain("3 panels");
  });

  it("keeps a bare quantity when the line has no unit", () => {
    const html = renderToStaticMarkup(
      <DocumentA4 {...base} lines={[{ title: "Wash", qty: 2, rateCents: 100000, amountCents: 200000 }]} />,
    );
    expect(html).not.toContain("2 undefined");
  });

  it("tells the printer not to split a table inside a line across pages", () => {
    const html = renderToStaticMarkup(<DocumentA4 {...base} />);
    expect(html).toContain("table { page-break-inside: avoid; }");
  });
});
