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
    { key: "a", productId: "p1", title: "Full Decontamination & Body Polish", description: "", rich: null, unitLabel: "", qty: 1, unitCents: 3200000, discountPct: 0, discountKind: "percent", discountAmountCents: 0, discountPolicy: "free", vatRatePct: 15, lineKind: null, priceInclusive: false },
    { key: "b", productId: "p2", title: "Remove Wheel, Decontamination & Polish", description: "", rich: null, unitLabel: "", qty: 4, unitCents: 380000, discountPct: 0, discountKind: "percent", discountAmountCents: 0, discountPolicy: "free", vatRatePct: 15, lineKind: null, priceInclusive: false },
    { key: "c", productId: "p3", title: "Diamondbrite 3-Year Protection (Exterior Only)", description: "", rich: null, unitLabel: "", qty: 1, unitCents: 3000000, discountPct: 0, discountKind: "percent", discountAmountCents: 0, discountPolicy: "free", vatRatePct: 15, lineKind: null, priceInclusive: false },
  ],
  docDiscountKind: null,
  docDiscountValue: 0,
  docDiscountReason: "",
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

describe("toDocumentProps — a VAT-inclusive shop lands the A4 on the typed gross", () => {
  // The dash cam: a price_includes_vat product priced at a round Rs 9,900 gross. On a gross-quoting
  // shop the builder stores unitCents = the exact gross with priceInclusive = true, and the A4
  // preview/PDF must NOT re-gross it (that inflated every inclusive line by the VAT factor before).
  const inclState: BuilderState = {
    ...state,
    lines: [
      { key: "d", productId: "p9", title: "Dash Cam", description: "", rich: null, unitLabel: "", qty: 1, unitCents: 990000, discountPct: 0, discountKind: "percent", discountAmountCents: 0, discountPolicy: "free", vatRatePct: 15, lineKind: null, priceInclusive: true },
    ],
  };
  const props = toDocumentProps(inclState, business, {
    createdBy: "Rakesh",
    customerName: "Jean-Pierre Laval",
    customerCountry: "Mauritius",
    terms: ["Quotation is valid for 5 days."],
    pricesInclVat: true,
  });

  it("shows the exact gross as Rate, Amount, Subtotal and Total — not 1.15× it", () => {
    expect(props.lines[0].rateCents).toBe(990000);   // was grossCents(990000)=1138500
    expect(props.lines[0].amountCents).toBe(990000);
    expect(props.subtotalCents).toBe(990000);
    expect(props.totalCents).toBe(990000);
  });

  it("extracts VAT from the gross (9900 × 15/115), not adds it on top", () => {
    expect(props.vatCents).toBe(129130); // round(990000 × 15/115); NOT round(990000 × 0.15)=148500
  });
});

const PREVIEW = {
  createdBy: "Rakesh",
  customerName: "Jean-Pierre Laval",
  customerCountry: "Mauritius",
  terms: ["Quotation is valid for 5 days."],
};

describe("toDocumentProps — rich content reaches the preview", () => {
  const rich = {
    schemaVersion: 1 as const,
    blocks: [{ type: "ul" as const, items: [[{ text: "Full Vehicle decontamination" }]] }],
  };

  it("passes the tree and the unit straight through to the A4 props", () => {
    const s: BuilderState = {
      ...state,
      lines: [{ key: "a", productId: null, title: "Diamondbrite", description: "", rich, unitLabel: "panels", qty: 3, unitCents: 100000, discountPct: 0, discountKind: "percent", discountAmountCents: 0, discountPolicy: "free", vatRatePct: 15, lineKind: null, priceInclusive: false }],
    };
    const props = toDocumentProps(s, business, PREVIEW);
    expect(props.lines[0].rich).toEqual(rich);
    expect(props.lines[0].unit).toBe("panels");
  });

  it("sends null rather than an empty string when a line has no unit", () => {
    const s: BuilderState = {
      ...state,
      lines: [{ key: "a", productId: null, title: "Wash", description: "", rich: null, unitLabel: "", qty: 1, unitCents: 100000, discountPct: 0, discountKind: "percent", discountAmountCents: 0, discountPolicy: "free", vatRatePct: 15, lineKind: null, priceInclusive: false }],
    };
    const props = toDocumentProps(s, business, PREVIEW);
    expect(props.lines[0].unit).toBeNull();
    expect(props.lines[0].rich).toBeNull();
  });
});
