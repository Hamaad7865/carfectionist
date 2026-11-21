import { describe, expect, it } from "vitest";
import type { CounterProduct } from "@/lib/supabase/queries/counter";
import { ANY_SIZE, buildCatalogue, filterCatalogue, lastTyreSize, sizeOptions } from "./catalogue-model";

const product = (id: string, name: string, kind = "product", priceCents = 1000): CounterProduct => ({
  id,
  name,
  kind,
  category: null,
  priceCents,
  vatRate: 15,
  discountPolicy: "goods" as CounterProduct["discountPolicy"],
  priceIncludesVat: false,
  barcode: null,
  photoUrl: null,
  isStocked: kind !== "service",
  shopQty: 5,
  warehouseQty: 0,
});

const items = buildCatalogue(
  [
    product("t1", "Bridgestone Ecopia EP150 195/65R15 91H", "product", 295000),
    product("t2", "Hankook Kinergy Eco 2 205/55R16 91V", "product", 238000),
    product("v", "Tubeless valve TR414", "consumable", 5000),
    product("s", "Wheel alignment", "service", 130000),
  ],
  { t2: 9, v: 40 },
);

describe("filterCatalogue", () => {
  it("narrows tyres to the size but keeps the parts and services that go with them", () => {
    const r = filterCatalogue(items, { q: "", category: "all", size: { width: 195, profile: null, rim: null }, sort: "name" });
    expect(r.map((i) => i.product.id)).toEqual(["t1", "v", "s"]);
  });

  it("sorts best sellers first and filters by chip and search", () => {
    expect(filterCatalogue(items, { q: "", category: "all", size: ANY_SIZE, sort: "best" })[0].product.id).toBe("v");
    expect(filterCatalogue(items, { q: "", category: "tyres", size: ANY_SIZE, sort: "price" }).map((i) => i.product.id)).toEqual(["t2", "t1"]);
    expect(filterCatalogue(items, { q: "align", category: "all", size: ANY_SIZE, sort: "best" }).map((i) => i.product.id)).toEqual(["s"]);
  });
});

describe("sizeOptions / lastTyreSize", () => {
  it("offers the sizes the shop stocks and finds a car's last tyre", () => {
    expect(sizeOptions(items)).toEqual({ width: [195, 205], profile: [55, 65], rim: [15, 16] });
    expect(lastTyreSize([{ lines: [{ title: "Wheel alignment" }] }, { lines: [{ title: "Ecopia EP150 195/65R15 91H" }] }])).toEqual({ width: 195, profile: 65, rim: 15 });
    expect(lastTyreSize([])).toBeNull();
  });
});
