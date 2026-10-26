import { describe, expect, it } from "vitest";
import { balancesAfter, onHandAt, roundQty } from "./balance";

const mv = (id: string, productId: string, locationId: string, qty: number) => ({ id, productId, locationId, qty });

describe("onHandAt", () => {
  it("reads the count for a product at a location", () => {
    expect(onHandAt({ p1: { shop: 4, wh: 7 } }, "p1", "wh")).toBe(7);
  });
  it("is zero when the ledger has never touched that pair", () => {
    expect(onHandAt({ p1: { shop: 4 } }, "p1", "wh")).toBe(0);
    expect(onHandAt({}, "p2", "shop")).toBe(0);
  });
});

describe("balancesAfter", () => {
  it("gives the newest movement the current on-hand", () => {
    const [m] = balancesAfter([mv("a", "p1", "shop", -1)], { p1: { shop: 5 } });
    expect(m.balanceAfter).toBe(5);
  });

  it("walks back through older movements of the same product and location", () => {
    // newest first: today −2, then +3, then the oldest −1
    const rows = balancesAfter(
      [mv("a", "p1", "shop", -2), mv("b", "p1", "shop", 3), mv("c", "p1", "shop", -1)],
      { p1: { shop: 6 } },
    );
    expect(rows.map((r) => r.balanceAfter)).toEqual([6, 8, 5]);
  });

  it("keeps each location's balance separate", () => {
    const rows = balancesAfter(
      [mv("a", "p1", "shop", 2), mv("b", "p1", "wh", -2), mv("c", "p1", "shop", 1)],
      { p1: { shop: 4, wh: 10 } },
    );
    expect(rows.map((r) => r.balanceAfter)).toEqual([4, 10, 2]);
  });

  it("keeps each product's balance separate", () => {
    const rows = balancesAfter(
      [mv("a", "p1", "shop", 1), mv("b", "p2", "shop", 1), mv("c", "p1", "shop", 1)],
      { p1: { shop: 3 }, p2: { shop: 9 } },
    );
    expect(rows.map((r) => r.balanceAfter)).toEqual([3, 9, 2]);
  });

  it("rounds fractional quantities to the ledger's 3 decimals", () => {
    const rows = balancesAfter(
      [mv("a", "p1", "shop", 0.1), mv("b", "p1", "shop", 0.2), mv("c", "p1", "shop", 0.1)],
      { p1: { shop: 0.7 } },
    );
    expect(rows.map((r) => r.balanceAfter)).toEqual([0.7, 0.6, 0.4]);
  });

  it("keeps the movement's own fields", () => {
    const [m] = balancesAfter([{ ...mv("a", "p1", "shop", -1), note: "stock count" }], { p1: { shop: 1 } });
    expect(m).toMatchObject({ id: "a", note: "stock count", qty: -1, balanceAfter: 1 });
  });
});

describe("roundQty", () => {
  it("drops float noise past 3 decimals", () => {
    expect(roundQty(0.1 + 0.2)).toBe(0.3);
    expect(roundQty(2.9999999)).toBe(3);
    expect(roundQty(4 - 1.1)).toBe(2.9);
  });
});
