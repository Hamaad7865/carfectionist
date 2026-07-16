import { describe, it, expect } from "vitest";
import { stockState, isLow, canMove, type StockLevel } from "./low";

// The bell and the catalogue used to answer this question differently — 11 vs 36
// on the same live catalogue. These are the rules they now share.

const level = (over: Partial<StockLevel> = {}): StockLevel => ({
  isStocked: true,
  threshold: 5,
  floorQty: 10,
  totalQty: 40,
  ...over,
});

describe("stockState", () => {
  it("says nothing when the floor is stocked above the threshold", () => {
    expect(stockState(level({ floorQty: 10 }))).toBe("ok");
  });

  it("is LOW when the floor is short but the warehouse has some — that's a transfer", () => {
    expect(stockState(level({ floorQty: 2, totalQty: 37 }))).toBe("low");
  });

  it("is OUT when there is none anywhere — no transfer can fix that", () => {
    expect(stockState(level({ floorQty: 0, totalQty: 0 }))).toBe("out");
  });

  it("treats the threshold as a floor, not a trigger — AT the threshold is fine", () => {
    expect(stockState(level({ floorQty: 5, threshold: 5 }))).toBe("ok");
    expect(stockState(level({ floorQty: 4.999, threshold: 5 }))).toBe("low");
  });

  it("has no opinion without a threshold — the owner never set one", () => {
    expect(stockState(level({ threshold: null, floorQty: 0, totalQty: 0 }))).toBe("ok");
  });

  it("has no opinion about a service — nothing is stocked", () => {
    expect(stockState(level({ isStocked: false, floorQty: 0, totalQty: 0 }))).toBe("ok");
  });

  it("has no opinion when there is no selling floor to measure against", () => {
    // A tenant with only a warehouse: nothing is "low at the floor" because
    // there is no floor.
    expect(stockState(level({ floorQty: null }))).toBe("ok");
  });

  it("counts an oversold floor as low, not ok", () => {
    // A negative floor is still short of the threshold.
    expect(stockState(level({ floorQty: -1, totalQty: 20 }))).toBe("low");
    expect(stockState(level({ floorQty: -1, totalQty: 0 }))).toBe("out");
  });

  it("is out, not low, when the only stock left IS the negative floor", () => {
    // floor -2, nothing elsewhere → total is negative, so there is nothing to move
    expect(stockState(level({ floorQty: -2, totalQty: -2 }))).toBe("out");
  });
});

describe("isLow — what the bell counts and the filter shows", () => {
  it("is exactly the low state, never the out state", () => {
    expect(isLow(level({ floorQty: 2, totalQty: 37 }))).toBe(true);
    expect(isLow(level({ floorQty: 0, totalQty: 0 }))).toBe(false);
    expect(isLow(level({ floorQty: 10 }))).toBe(false);
  });
});

describe("canMove — whether a warehouse trip would find anything", () => {
  it("is true only when stock sits somewhere other than the floor", () => {
    expect(canMove(level({ floorQty: 2, totalQty: 37 }))).toBe(true); // 35 elsewhere
  });

  it("is FALSE when the floor holds everything there is", () => {
    // The live case that mattered: 9 of 11 low products looked restockable, but
    // their whole stock was already on the floor and the warehouse was empty.
    expect(canMove(level({ floorQty: 2, totalQty: 2 }))).toBe(false);
    expect(isLow(level({ floorQty: 2, totalQty: 2 }))).toBe(true); // still low…
  });

  it("is false when there's nothing at all", () => {
    expect(canMove(level({ floorQty: 0, totalQty: 0 }))).toBe(false);
  });

  it("copes with an oversold floor", () => {
    // floor -1 with 5 in the warehouse: total 4, elsewhere 5 → movable
    expect(canMove(level({ floorQty: -1, totalQty: 4 }))).toBe(true);
  });
});
