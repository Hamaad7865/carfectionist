import { describe, expect, it } from "vitest";
import { parseBasis, planPriceBasis, productsToUnflag, repricedRows } from "./import-vat";

describe("parseBasis", () => {
  it("reads yes / no words, case and spaces ignored; blank is the shop default", () => {
    for (const v of ["yes", "YES", " Y ", "true", "1", "incl", "Inclusive"]) expect(parseBasis(v)).toBe(true);
    for (const v of ["no", "N", "false", "0", "excl", "Exclusive", "net"]) expect(parseBasis(v)).toBe(false);
    expect(parseBasis("")).toBeNull();
    expect(parseBasis("   ")).toBeNull();
    expect(parseBasis(undefined)).toBeNull();
  });
  it("refuses anything else rather than guessing", () => {
    for (const v of ["maybe", "vat", "15", "yes please", "ttc", "incl vat"]) expect(parseBasis(v)).toBeUndefined();
  });
});

describe("planPriceBasis", () => {
  it("a sheet without the column is ONE untouched group with the shop default", () => {
    const rows = [{ sku: "A", name: "A", selling_price: "100" }, { sku: "B", name: "B", selling_price: "200" }];
    const plan = planPriceBasis(rows);
    expect(plan.errors).toEqual([]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].basis).toBeNull();
    expect(plan.groups[0].rows).toBe(rows); // same array: byte-identical to the old single call
  });

  it("splits the rows by answer and keeps file order inside each", () => {
    const rows = [
      { sku: "A", selling_price: "115", price_includes_vat: "yes" },
      { sku: "B", selling_price: "100", price_includes_vat: "no" },
      { sku: "C", selling_price: "50", price_includes_vat: "" },
      { sku: "D", selling_price: "230", price_includes_vat: "Y" },
    ];
    const plan = planPriceBasis(rows);
    expect(plan.errors).toEqual([]);
    expect(plan.groups.map((g) => [g.basis, g.rows.map((r) => r.sku)])).toEqual([
      [null, ["C"]],
      [true, ["A", "D"]],
      [false, ["B"]],
    ]);
  });

  it("refuses a row whose answer is not understood and imports the rest", () => {
    const plan = planPriceBasis([
      { sku: "A", name: "A", selling_price: "115", price_includes_vat: "maybe" },
      { sku: "B", name: "B", selling_price: "100", price_includes_vat: "no" },
    ]);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toMatchObject({ sku: "A", name: "A" });
    expect(plan.errors[0].error).toContain("maybe");
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].rows.map((r) => r.sku)).toEqual(["B"]);
  });

  it("refuses a product that appears with two different answers (no silent last-wins)", () => {
    const plan = planPriceBasis([
      { sku: "A", selling_price: "115", price_includes_vat: "yes" },
      { sku: "A", selling_price: "100", price_includes_vat: "no" },
      { sku: "B", selling_price: "100", price_includes_vat: "no" },
    ]);
    expect(plan.errors.map((e) => e.sku)).toEqual(["A", "A"]);
    expect(plan.groups.flatMap((g) => g.rows.map((r) => r.sku))).toEqual(["B"]);
  });

  it("the same answer twice is fine; an answer vs blank is a clash too", () => {
    const same = planPriceBasis([
      { sku: "A", selling_price: "1", price_includes_vat: "yes" },
      { sku: "A", selling_price: "2", price_includes_vat: "yes" },
    ]);
    expect(same.errors).toEqual([]);
    const vsBlank = planPriceBasis([
      { sku: "A", selling_price: "1", price_includes_vat: "yes" },
      { sku: "A", selling_price: "2", price_includes_vat: "" },
    ]);
    expect(vsBlank.errors).toHaveLength(2);
  });

  it("name-only rows clash by case-insensitive name", () => {
    const plan = planPriceBasis([
      { name: "Wax", selling_price: "1", price_includes_vat: "yes" },
      { name: "WAX", selling_price: "2", price_includes_vat: "no" },
    ]);
    expect(plan.errors).toHaveLength(2);
    expect(plan.groups).toEqual([]);
  });

  it("a row lacking the cell entirely (ragged sheet) takes the shop default", () => {
    const plan = planPriceBasis([{ sku: "A", selling_price: "1", price_includes_vat: "no" }, { sku: "B", selling_price: "2" }]);
    expect(plan.groups.map((g) => g.basis)).toEqual([null, false]);
  });
});

describe("repricedRows", () => {
  it("counts rows that carried a price and did not error", () => {
    const rows = [
      { sku: "A", name: "A", selling_price: "10" },
      { sku: "B", name: "B", selling_price: "" },
      { sku: "C", name: "C", selling_price: "x" },
      { sku: "", name: "", selling_price: "5" },
      { sku: "", name: "Wax", selling_price: "5" },
    ];
    expect(repricedRows(rows, [{ sku: "C", name: "C" }])).toEqual([
      { sku: "A", name: "A" },
      { sku: "", name: "Wax" },
    ]);
  });
  it("an error for one product does not hide another with the same name but a different SKU", () => {
    const rows = [
      { sku: "A1", name: "Wax", selling_price: "10" },
      { sku: "A2", name: "Wax", selling_price: "10" },
    ];
    expect(repricedRows(rows, [{ sku: "A1", name: "Wax" }])).toEqual([{ sku: "A2", name: "Wax" }]);
  });
});

describe("productsToUnflag", () => {
  const products = [
    { id: "1", sku: "A", name: "Dash cam", price_includes_vat: true },
    { id: "2", sku: "B", name: "Wax", price_includes_vat: false },
    { id: "3", sku: null, name: "Polish", price_includes_vat: true },
    { id: "4", sku: null, name: "Twin", price_includes_vat: true },
    { id: "5", sku: null, name: "twin", price_includes_vat: false },
  ];
  it("unflags only flagged products the sheet repriced", () => {
    expect(
      productsToUnflag([{ sku: "A", name: "x" }, { sku: "B", name: "Wax" }, { sku: "", name: "polish" }], products).sort(),
    ).toEqual(["1", "3"]);
  });
  it("never guesses between two products with the same name", () => {
    expect(productsToUnflag([{ sku: "", name: "Twin" }], products)).toEqual([]);
  });
  it("a SKU that resolves to nothing unflags nothing", () => {
    expect(productsToUnflag([{ sku: "ZZ", name: "Dash cam" }], products)).toEqual([]);
  });
});
