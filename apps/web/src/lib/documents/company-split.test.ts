import { describe, expect, it } from "vitest";
import {
  combinedTotalCents,
  lineCompanyId,
  orderCompanies,
  readCompanyDiscounts,
  spansCompanies,
  splitByCompany,
  toCheckoutDiscounts,
  type SplitCompany,
} from "./company-split";

const GARAGE: SplitCompany = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Garage De L'Est", legalName: "Garage De L'Est LTEE", vatRegistered: true, quotePrefix: "Q-", sortOrder: 0, isDefault: true };
const SERVICE: SplitCompany = { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Service", legalName: "Service", vatRegistered: false, quotePrefix: "SQ-", sortOrder: 1, isDefault: false };

type L = { title: string; productId: string | null; qty: number; unitCents: number; vatRatePct: number };
const tyre: L = { title: "Tyre 205/55 R16", productId: "p-tyre", qty: 4, unitCents: 435000, vatRatePct: 15 };
const valve: L = { title: "Valve", productId: "p-valve", qty: 4, unitCents: 15000, vatRatePct: 15 };
const fitting: L = { title: "Fitting", productId: "p-fit", qty: 4, unitCents: 30000, vatRatePct: 0 };
const alignment: L = { title: "Alignment", productId: "p-align", qty: 1, unitCents: 120000, vatRatePct: 0 };
const custom: L = { title: "Hand-typed", productId: null, qty: 1, unitCents: 10000, vatRatePct: 15 };

const productCompany = new Map<string, string | null>([
  ["p-tyre", GARAGE.id],
  ["p-valve", null], // no company set → the default company sells it
  ["p-fit", SERVICE.id],
  ["p-align", SERVICE.id],
]);
const companies = [SERVICE, GARAGE]; // deliberately out of order
const companyOf = (l: L) => lineCompanyId(l.productId, productCompany, companies);

describe("lineCompanyId — mirrors app.lines_stamp_entity", () => {
  it("a product's own company sells its line", () => {
    expect(lineCompanyId("p-fit", productCompany, companies)).toBe(SERVICE.id);
  });
  it("a product with no company, a hand-typed line, an unknown product → the default company", () => {
    expect(lineCompanyId("p-valve", productCompany, companies)).toBe(GARAGE.id);
    expect(lineCompanyId(null, productCompany, companies)).toBe(GARAGE.id);
    expect(lineCompanyId("p-gone", productCompany, companies)).toBe(GARAGE.id);
  });
  it("a hand-typed line → the draft's stored company (it followed its lines), unknown → default", () => {
    expect(lineCompanyId(null, productCompany, companies, SERVICE.id)).toBe(SERVICE.id);
    expect(lineCompanyId(null, productCompany, companies, "gone")).toBe(GARAGE.id);
    expect(lineCompanyId("p-tyre", productCompany, companies, SERVICE.id)).toBe(GARAGE.id); // a product ignores it
  });
  it("a product pointing at a company the shop no longer lists → the default company", () => {
    expect(lineCompanyId("p-x", new Map([["p-x", "zzz"]]), companies)).toBe(GARAGE.id);
  });
});

describe("splitByCompany — one quote per company, in the database's order", () => {
  it("a mixed quote becomes two parts, company order (sort_order), lines kept in their order", () => {
    const parts = splitByCompany([fitting, tyre, alignment, valve], companyOf, companies);
    expect(parts.map((p) => p.company.id)).toEqual([GARAGE.id, SERVICE.id]);
    expect(parts.map((p) => p.index)).toEqual([0, 1]);
    expect(parts[0].lines.map((l) => l.title)).toEqual(["Tyre 205/55 R16", "Valve"]);
    expect(parts[1].lines.map((l) => l.title)).toEqual(["Fitting", "Alignment"]);
    expect(spansCompanies(parts)).toBe(true);
  });

  it("each part carries its own subtotal, VAT and total; the combined total adds them", () => {
    const parts = splitByCompany([tyre, valve, fitting, alignment], companyOf, companies);
    expect(parts[0].totals.subtotalCents).toBe(1_800_000);
    expect(parts[0].totals.vatCents).toBe(270_000);
    expect(parts[0].totals.totalCents).toBe(2_070_000);
    expect(parts[1].totals.vatCents).toBe(0); // the non-VAT company: VAT exempt
    expect(parts[1].totals.totalCents).toBe(240_000);
    expect(combinedTotalCents(parts)).toBe(2_310_000);
  });

  it("a non-VAT company's line carries no VAT even if its product says 15% (lines_stamp_entity forces 0)", () => {
    const taxedFitting: L = { ...fitting, vatRatePct: 15 };
    const parts = splitByCompany([tyre, taxedFitting], companyOf, companies);
    expect(parts[1].company.id).toBe(SERVICE.id);
    expect(parts[1].totals.vatCents).toBe(0);
    expect(parts[1].totals.totalCents).toBe(120_000);
    expect(parts[1].lines[0].vatRatePct).toBe(15); // the line itself is handed back untouched
  });

  it("the preview lands on the figures issue_checkout stores (scripts/_verify-quote-split.mjs fixture)", () => {
    const brush: L = { title: "Rim brush", productId: "p-tyre", qty: 2, unitCents: 200000, vatRatePct: 15 };
    const align: L = { title: "Wheel alignment", productId: "p-align", qty: 1, unitCents: 130000, vatRatePct: 15 };
    const parts = splitByCompany([brush, align], companyOf, companies, { [GARAGE.id]: { kind: "percent", value: 5, reason: "regular customer" } });
    expect(parts.map((p) => p.totals.totalCents)).toEqual([437_000, 130_000]); // 4370.00 + 1300.00 in the database
    expect(parts[1].totals.vatCents).toBe(0);
  });

  it("a one-company quote is one part — nothing to split (Carfectionist sees no change)", () => {
    const parts = splitByCompany([tyre, valve, custom], companyOf, companies);
    expect(parts).toHaveLength(1);
    expect(spansCompanies(parts)).toBe(false);
  });

  it("a one-company shop: every line lands on its only company", () => {
    const solo: SplitCompany = { ...GARAGE, isDefault: true };
    const parts = splitByCompany([tyre, fitting], (l) => lineCompanyId(l.productId, new Map(), [solo]), [solo]);
    expect(parts).toHaveLength(1);
    expect(parts[0].lines).toHaveLength(2);
  });

  it("no lines → no parts", () => {
    expect(splitByCompany([], companyOf, companies)).toEqual([]);
  });

  it("a company's discount applies to its own quote only", () => {
    const parts = splitByCompany([tyre, valve, fitting, alignment], companyOf, companies, {
      [SERVICE.id]: { kind: "percent", value: 10 },
    });
    expect(parts[0].discount).toBeNull();
    expect(parts[0].totals.totalCents).toBe(2_070_000);
    expect(parts[1].discount).toEqual({ kind: "percent", value: 10 });
    expect(parts[1].totals.totalCents).toBe(216_000);
  });
});

describe("orderCompanies", () => {
  it("sort_order first, then id — the order split_by_company numbers in", () => {
    const a = { id: "b", sortOrder: 0 };
    const b = { id: "a", sortOrder: 0 };
    const c = { id: "0", sortOrder: 5 };
    expect(orderCompanies([c, a, b]).map((x) => x.id)).toEqual(["a", "b", "0"]);
  });
});

describe("per-company discounts on the draft", () => {
  it("reads only well-formed discounts", () => {
    const got = readCompanyDiscounts({
      bankDetails: true,
      companyDiscounts: {
        [GARAGE.id]: { kind: "amount", value: 50000, reason: "loyal" },
        [SERVICE.id]: { kind: "percent", value: 10 },
        bad1: { kind: "percent", value: 150 },
        bad2: { kind: "free", value: 5 },
        bad3: { kind: "amount", value: 0 },
        bad4: null,
      },
    });
    expect(Object.keys(got).sort()).toEqual([GARAGE.id, SERVICE.id].sort());
    expect(got[GARAGE.id]).toEqual({ kind: "amount", value: 50000, reason: "loyal" });
  });

  it("nothing stored → nothing", () => {
    expect(readCompanyDiscounts(null)).toEqual({});
    expect(readCompanyDiscounts({ companyDiscounts: [] })).toEqual({});
  });

  it("hands issue_checkout rupees for an amount, the percent as-is, only for companies on the draft", () => {
    const d = { [GARAGE.id]: { kind: "amount" as const, value: 50050, reason: " loyal " }, [SERVICE.id]: { kind: "percent" as const, value: 10 }, other: { kind: "percent" as const, value: 5 } };
    expect(toCheckoutDiscounts(d, [GARAGE.id, SERVICE.id])).toEqual([
      { legal_entity_id: GARAGE.id, discount_kind: "amount", discount_value: 500.5, discount_reason: "loyal" },
      { legal_entity_id: SERVICE.id, discount_kind: "percent", discount_value: 10, discount_reason: null },
    ]);
  });
});
