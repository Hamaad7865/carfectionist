import { describe, expect, it } from "vitest";
import { pointsEarned, pointsToSpend, pointsValueCents } from "./points";

describe("pointsEarned", () => {
  it("earns on the sale total at the shop rate — Rs 1,150 at 1 per Rs 100 is 11", () => {
    expect(pointsEarned({ totalCents: 115_000, pointsPaidCents: 0, pointsPer100: 1 })).toBe(11);
  });

  it("ignores the share settled with points — the exclusion bites at the next rupee, not this one", () => {
    // Same Rs 1,150 bill, Rs 50 of it already paid in points. Rs 1,100 earning at
    // 1 per Rs 100 is still 11 — the flooring doesn't move until Rs 1,200.
    expect(pointsEarned({ totalCents: 115_000, pointsPaidCents: 5_000, pointsPer100: 1 })).toBe(11);
  });

  it("rounds down — a part point is not a point", () => {
    expect(pointsEarned({ totalCents: 9_900, pointsPaidCents: 0, pointsPer100: 1 })).toBe(0);
  });

  it("honours a rate above one", () => {
    expect(pointsEarned({ totalCents: 100_000, pointsPaidCents: 0, pointsPer100: 2.5 })).toBe(25);
  });

  it("earns nothing on a bill settled entirely in points", () => {
    expect(pointsEarned({ totalCents: 50_000, pointsPaidCents: 50_000, pointsPer100: 1 })).toBe(0);
  });

  it("a zero rate earns nothing, without throwing", () => {
    expect(pointsEarned({ totalCents: 100_000, pointsPaidCents: 0, pointsPer100: 0 })).toBe(0);
  });

  it("a negative rate earns nothing, without throwing", () => {
    expect(pointsEarned({ totalCents: 100_000, pointsPaidCents: 0, pointsPer100: -1 })).toBe(0);
  });
});

describe("pointsToSpend", () => {
  it("rounds up — the shop is never out of pocket for a fraction of a point", () => {
    expect(pointsToSpend(5_050, 1)).toBe(51);
  });

  it("honours a point worth more than a rupee", () => {
    expect(pointsToSpend(10_000, 5)).toBe(20);
  });
});

describe("pointsValueCents", () => {
  it("states what a balance is worth", () => {
    expect(pointsValueCents(120, 1)).toBe(12_000);
  });
});
