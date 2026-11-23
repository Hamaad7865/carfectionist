import { describe, expect, it } from "vitest";
import fixture from "./tyre-size.fixture.json";
import {
  attrSearchText,
  brandKey,
  brandOptions,
  brandsForSize,
  formatSizeQuery,
  formatTyreSpec,
  isTyreCategory,
  matchesAttrFilter,
  normaliseBrand,
  parseSizeQuery,
  parseTyreSpec,
  productSearchMatches,
  showsTyreFields,
  sizesForBrand,
  type AttrItem,
  type SizeQuery,
} from "./tyre-size";

const size = (a: number[] | null) => (a ? { width: a[0], profile: a[1], rim: a[2] } : null);
const items: AttrItem[] = fixture.summary.items.map((i) => ({ brand: i.brand, size: size(i.size), qty: i.qty }));

describe("parseTyreSpec (shared fixture)", () => {
  for (const c of fixture.spec) {
    it(JSON.stringify(c.in), () => {
      const got = parseTyreSpec(c.in);
      if (c.out == null) return expect(got).toBeNull();
      expect(got).toEqual({
        size: { width: c.out.width, profile: c.out.profile, rim: c.out.rim },
        loadIndex: c.out.load,
        speedRating: c.out.speed,
      });
    });
  }
});

describe("parseSizeQuery (shared fixture)", () => {
  for (const c of fixture.query) {
    it(JSON.stringify(c.in), () => expect(parseSizeQuery(c.in)).toEqual(c.out));
  }
});

describe("size ↔ brand summaries (shared fixture)", () => {
  for (const c of fixture.summary.brandsForSize) {
    it(`brands in ${c.query}`, () => {
      const rows = brandsForSize(items, parseSizeQuery(c.query) as SizeQuery);
      expect(rows.map((r) => [r.key, r.brand, r.products, r.qty])).toEqual(c.out);
    });
  }
  for (const c of fixture.summary.sizesForBrand) {
    it(`sizes of ${c.brand}`, () => {
      expect(sizesForBrand(items, c.brand).map((r) => [r.label, r.products, r.qty])).toEqual(c.out);
    });
  }
  it("brand options group spellings, most common wins", () => {
    expect(brandOptions(items).map((r) => [r.key, r.brand, r.products, r.qty])).toEqual(fixture.summary.brandOptions);
  });
});

describe("format (shared fixture)", () => {
  for (const c of fixture.format) {
    it(c.out, () => expect(formatTyreSpec(size(c.size)!, c.load, c.speed)).toBe(c.out));
  }
  it("reads a partial query back", () => {
    expect(formatSizeQuery({ width: 205, profile: 55, rim: null })).toBe("205/55");
    expect(formatSizeQuery({ width: null, profile: null, rim: 16 })).toBe("R16");
  });
});

describe("brand + category helpers", () => {
  it("normalises brands", () => {
    expect(normaliseBrand("  Michelin   Pilot ")).toBe("Michelin Pilot");
    expect(normaliseBrand("   ")).toBeNull();
    expect(brandKey(" MICHELIN")).toBe("michelin");
    expect(brandKey(null)).toBe("");
  });
  it("knows tyre-like categories", () => {
    for (const c of ["Tyres", "TIRES", "Pneus", "Jantes", "Wheels", "Car tyre"]) expect(isTyreCategory(c)).toBe(true);
    for (const c of ["Polish", "Services", "", null, "Tyrell"]) expect(isTyreCategory(c)).toBe(false);
  });
  it("never shows sizes on a service; keeps them once set", () => {
    expect(showsTyreFields({ kind: "service", category: "Wheel services" })).toBe(false);
    expect(showsTyreFields({ kind: "product", category: "Tyres" })).toBe(true);
    expect(showsTyreFields({ kind: "product", category: "Polish" })).toBe(false);
    expect(showsTyreFields({ kind: "product", category: "Polish", hasSize: true })).toBe(true);
  });
  it("filters by brand and partial size together", () => {
    const tyre = { brand: "Michelin", size: { width: 205, profile: 55, rim: 16 } };
    expect(matchesAttrFilter(tyre, { brandKey: "michelin", size: parseSizeQuery("205/55") })).toBe(true);
    expect(matchesAttrFilter(tyre, { brandKey: "bridgestone", size: null })).toBe(false);
    expect(matchesAttrFilter(tyre, { brandKey: "", size: parseSizeQuery("R17") })).toBe(false);
    expect(matchesAttrFilter({ brand: null, size: null }, { brandKey: "", size: null })).toBe(true);
  });
  it("search text carries brand and the common size spellings", () => {
    const t = attrSearchText("Michelin", { width: 205, profile: 55, rim: 16 }, "91", "V");
    for (const w of ["michelin", "205/55 r16 91v", "205/55r16", "2055516"]) expect(t).toContain(w);
  });
});

describe("productSearchMatches (shared fixture)", () => {
  const its = fixture.search.items;
  for (const c of fixture.search.cases) {
    it(JSON.stringify(c.q), () => {
      const hits = its
        .map((p, i) => (productSearchMatches(c.q, [p.name, p.barcode], { brand: p.brand, size: size(p.size), loadIndex: p.load, speedRating: p.speed }) ? i : -1))
        .filter((i) => i >= 0);
      expect(hits).toEqual(c.out);
    });
  }
});
