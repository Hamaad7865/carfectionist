import { describe, it, expect } from "vitest";
import { computeTotals, type TotalsLineInput, type DocDiscount } from "./totals";

// Mirrors the rolled-back DB verification (values in cents). The TS math MUST
// match the Postgres generated columns + app.discounted_vat_groups exactly.
const L = (unitCents: number, qty = 1, extra: Partial<TotalsLineInput> = {}): TotalsLineInput => ({ qty, unitCents, vatRatePct: 15, ...extra });
const t = (lines: TotalsLineInput[], d?: DocDiscount | null) => {
  const r = computeTotals(lines, d);
  return [r.subtotalCents, r.vatCents, r.totalCents];
};

const CANON = [L(3_200_000), L(380_000, 4), L(3_000_000)];

describe("discount math (mirrors DB)", () => {
  it("no discount → canonical 88,780 vector", () => {
    expect(t(CANON)).toEqual([7_720_000, 1_158_000, 8_878_000]);
  });

  it("line fixed Rs 1,150 (VAT-inclusive) off a line → total drops exactly 1,150", () => {
    expect(t([L(3_200_000, 1, { discountKind: "amount", discountAmountCents: 115_000 }), L(380_000, 4), L(3_000_000)]))
      .toEqual([7_620_000, 1_143_000, 8_763_000]);
  });

  it("line 10% off a line", () => {
    expect(t([L(3_200_000, 1, { discountPct: 10 }), L(380_000, 4), L(3_000_000)]))
      .toEqual([7_400_000, 1_110_000, 8_510_000]);
  });

  it("order 10% off the whole total", () => {
    expect(t(CANON, { kind: "percent", value: 10 })).toEqual([6_948_000, 1_042_200, 7_990_200]);
  });

  it("order Rs 8,878 (= 10% of the total) matches the percent case", () => {
    expect(t(CANON, { kind: "amount", value: 887_800 })).toEqual([6_948_000, 1_042_200, 7_990_200]);
  });

  it("mixed VAT (15% + 0%), order Rs 500 apportioned per rate", () => {
    expect(t([L(1_000_000), L(100_000, 1, { vatRatePct: 0 })], { kind: "amount", value: 50_000 }))
      .toEqual([1_056_000, 144_000, 1_200_000]);
  });

  it("combined: line-Rs + line-% + order-% all at once", () => {
    expect(t(
      [L(3_200_000, 1, { discountKind: "amount", discountAmountCents: 115_000 }), L(380_000, 4), L(3_000_000, 1, { discountPct: 10 })],
      { kind: "percent", value: 10 },
    )).toEqual([6_588_000, 988_200, 7_576_200]);
  });

  it("fixed Rs discount is capped at the total (never negative)", () => {
    const r = computeTotals(CANON, { kind: "amount", value: 99_999_999 });
    expect(r.totalCents).toBe(0);
    expect(r.subtotalCents).toBe(0);
  });
});
