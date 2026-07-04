import { describe, it, expect } from "vitest";
import { effectiveSections, isSectionLocked } from "./fiscal-lock";

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
