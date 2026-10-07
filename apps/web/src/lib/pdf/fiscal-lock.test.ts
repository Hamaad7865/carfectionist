import { describe, it, expect } from "vitest";
import { effectiveSections, isSectionLocked, billToAddress } from "./fiscal-lock";

describe("effectiveSections — fiscal lock", () => {
  it("honours config on quotes", () => {
    const s = effectiveSections({ from: false, bankDetails: false, terms: false }, "quote");
    expect(s.from).toBe(false);
    expect(s.bankDetails).toBe(false);
    expect(s.terms).toBe(false);
  });

  it("forces legal fields visible on invoices even if config tries to hide them", () => {
    const s = effectiveSections({ from: false, vatBreakdown: false, totalInWords: false }, "invoice");
    expect(s.from).toBe(true);
    expect(s.vatBreakdown).toBe(true);
    expect(s.totalInWords).toBe(true);
  });

  it("still lets invoices hide non-legal sections", () => {
    const s = effectiveSections({ bankDetails: false, terms: false }, "invoice");
    expect(s.bankDetails).toBe(false);
    expect(s.terms).toBe(false);
  });

  it("credit notes are locked like invoices", () => {
    expect(effectiveSections({ from: false }, "credit_note").from).toBe(true);
  });

  it("isSectionLocked reflects the rule", () => {
    expect(isSectionLocked("from", "invoice")).toBe(true);
    expect(isSectionLocked("from", "quote")).toBe(false);
    expect(isSectionLocked("bankDetails", "invoice")).toBe(false);
  });
});

describe("billToAddress — which address a document prints", () => {
  it("a draft follows the customer's record (nothing is frozen yet)", () => {
    expect(billToAddress({ docType: "invoice", status: "draft", frozen: null }, "12 Royal Road, Moka")).toBe("12 Royal Road, Moka");
  });

  it("an issued invoice prints the address it was issued with, whatever the customer says now", () => {
    expect(billToAddress({ docType: "invoice", status: "issued", frozen: "Old Street, Curepipe" }, "12 Royal Road, Moka")).toBe("Old Street, Curepipe");
  });

  it("an invoice issued WITHOUT an address stays without one — a later edit never rewrites it", () => {
    expect(billToAddress({ docType: "invoice", status: "issued", frozen: null }, "12 Royal Road, Moka")).toBe("");
    expect(billToAddress({ docType: "invoice", status: "paid", frozen: null }, "12 Royal Road, Moka")).toBe("");
    expect(billToAddress({ docType: "credit_note", status: "issued", frozen: null }, "12 Royal Road, Moka")).toBe("");
  });

  it("an issued quotation with no frozen address picks up the customer's — a quote is revisable", () => {
    expect(billToAddress({ docType: "quote", status: "issued", frozen: null }, "12 Royal Road, Moka")).toBe("12 Royal Road, Moka");
    expect(billToAddress({ docType: "quote", status: "accepted", frozen: "Old Street, Curepipe" }, "12 Royal Road, Moka")).toBe("Old Street, Curepipe");
  });

  it("is empty, never 'null' or whitespace, when there is no address anywhere", () => {
    expect(billToAddress({ docType: "quote", status: "draft", frozen: null }, null)).toBe("");
    expect(billToAddress({ docType: "invoice", status: "draft", frozen: undefined }, "   ")).toBe("");
  });
});
