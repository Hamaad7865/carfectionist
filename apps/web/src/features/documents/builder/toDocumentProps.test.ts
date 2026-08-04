import { describe, it, expect } from "vitest";
import { toDocumentProps, type BuilderBusiness } from "./toDocumentProps";
import type { BuilderState } from "./state";

const business: BuilderBusiness = {
  tradingName: "Carfectionist",
  legalName: "Diamondbrite Reunion (Mauritius) Ltd",
  country: "Mauritius",
  brn: "C22190760",
  email: "carfectionist@gmail.com",
  phone: "+230 5258 8854",
  vatNo: "VAT28070619",
  bankAccountName: "Diamondbrite Reunion (Mauritius) Ltd",
  bankAccountNumber: "000449884716",
  bankName: "MCB",
};

const state: BuilderState = {
  docId: null,
  docType: "quote",
  status: "draft",
  number: null,
  issueDate: null,
  customerId: "c1",
  revision: 0,
  lines: [
    { key: "a", productId: "p1", title: "Full Decontamination & Body Polish", description: "", qty: 1, unitCents: 3200000, discountPct: 0, discountKind: "percent", discountAmountCents: 0, vatRatePct: 15, lineKind: null },
    { key: "b", productId: "p2", title: "Remove Wheel, Decontamination & Polish", description: "", qty: 4, unitCents: 380000, discountPct: 0, discountKind: "percent", discountAmountCents: 0, vatRatePct: 15, lineKind: null },
    { key: "c", productId: "p3", title: "Diamondbrite 3-Year Protection (Exterior Only)", description: "", qty: 1, unitCents: 3000000, discountPct: 0, discountKind: "percent", discountAmountCents: 0, vatRatePct: 15, lineKind: null },
  ],
  docDiscountKind: null,
  docDiscountValue: 0,
  sectionConfig: {},
  customFields: [],
  comment: "",
  dirty: false,
  save: "idle",
  saveError: null,
};

describe("toDocumentProps — the Rs 88,780 quote", () => {
  const props = toDocumentProps(state, business, {
    createdBy: "Rakesh",
    customerName: "Jean-Pierre Laval",
    customerCountry: "Mauritius",
    terms: ["Quotation is valid for 5 days."],
  });

  it("computes the totals in cents", () => {
    expect(props.subtotalCents).toBe(7720000);
    expect(props.vatCents).toBe(1158000);
    expect(props.totalCents).toBe(8878000);
  });

  it("maps line amounts (qty × rate)", () => {
    expect(props.lines[1].rateCents).toBe(380000);
    expect(props.lines[1].amountCents).toBe(1520000);
  });

  it("carries the identity + customer", () => {
    expect(props.from.brn).toBe("C22190760");
    expect(props.billTo.name).toBe("Jean-Pierre Laval");
  });
});
