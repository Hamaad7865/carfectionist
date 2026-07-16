import { describe, it, expect } from "vitest";
import { pickSalesFloor, pickDefault, toStockLocation, type StockLocation } from "./locations";

// Which location the till debits decides where stock actually leaves from, so
// getting it wrong is a real stock error, not a display bug. These are the rules.

const loc = (name: string, over: Partial<StockLocation> = {}): StockLocation => ({
  id: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  isDefault: false,
  isSalesFloor: false,
  isActive: true,
  ...over,
});

const TODAY = [loc("Warehouse", { isDefault: true }), loc("Shop", { isSalesFloor: true })];

describe("pickSalesFloor", () => {
  it("uses the flag — the fact, not a guess", () => {
    expect(pickSalesFloor(TODAY)?.name).toBe("Shop");
  });

  it("survives renaming the Shop, which name-matching would not", () => {
    const renamed = [loc("Warehouse", { isDefault: true }), loc("Front Counter", { isSalesFloor: true })];
    expect(pickSalesFloor(renamed)?.name).toBe("Front Counter");
  });

  it("is not fooled by a second warehouse — the whole point of the flag", () => {
    // The old rule was "the one that isn't the default", which here is a coin flip.
    const three = [
      loc("Warehouse", { isDefault: true }),
      loc("Warehouse 2"),
      loc("Shop", { isSalesFloor: true }),
    ];
    expect(pickSalesFloor(three)?.name).toBe("Shop");
    // …and it still says Shop whichever order the rows arrive in
    expect(pickSalesFloor([...three].reverse())?.name).toBe("Shop");
  });

  it("falls back to the name when no flag is set, reproducing the old behaviour", () => {
    const unflagged = [loc("Warehouse", { isDefault: true }), loc("Shop")];
    expect(pickSalesFloor(unflagged)?.name).toBe("Shop");
  });

  it("falls back to the first non-default when there is no flag and no 'Shop'", () => {
    const unflagged = [loc("Warehouse", { isDefault: true }), loc("Kiosk")];
    expect(pickSalesFloor(unflagged)?.name).toBe("Kiosk");
  });

  it("returns null rather than guessing when there is only a warehouse", () => {
    expect(pickSalesFloor([loc("Warehouse", { isDefault: true })])).toBeNull();
    expect(pickSalesFloor([])).toBeNull();
  });
});

describe("pickDefault", () => {
  it("is the flagged bulk store", () => {
    expect(pickDefault(TODAY)?.name).toBe("Warehouse");
  });
  it("is not confused by a second warehouse", () => {
    const three = [loc("Warehouse 2"), loc("Warehouse", { isDefault: true }), loc("Shop", { isSalesFloor: true })];
    expect(pickDefault(three)?.name).toBe("Warehouse");
  });
  it("falls back to the only location there is", () => {
    expect(pickDefault([loc("Storeroom")])?.name).toBe("Storeroom");
    expect(pickDefault([])).toBeNull();
  });
});

describe("toStockLocation", () => {
  it("reads the database row", () => {
    expect(toStockLocation({ id: "a", name: "Shop", is_default: false, is_sales_floor: true, is_active: true })).toEqual({
      id: "a", name: "Shop", isDefault: false, isSalesFloor: true, isActive: true,
    });
  });
  it("treats a row from before the migration as live, not retired", () => {
    // is_active absent must never read as "switched off" — that would hide real stock
    expect(toStockLocation({ id: "a", name: "Shop" }).isActive).toBe(true);
    expect(toStockLocation({ id: "a", name: "Shop", is_active: false }).isActive).toBe(false);
  });
});
