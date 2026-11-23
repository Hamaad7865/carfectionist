import { describe, expect, it } from "vitest";
import { planImportedAttrs, resolveImportedRow } from "./import-attrs";
import { attrColumns } from "./attr-columns";

describe("attrColumns", () => {
  it("reads a full size with load and speed", () => {
    expect(attrColumns({ brand: " Michelin ", tyreSize: "205/55r16", loadIndex: "91", speedRating: "v" })).toEqual({
      ok: true,
      columns: { brand: "Michelin", tyre_width: 205, tyre_profile: 55, tyre_rim: 16, tyre_load_index: "91", tyre_speed_rating: "V" },
    });
  });
  it("refuses a partial size, an orphan load index, and a size on a service", () => {
    expect(attrColumns({ tyreSize: "205/55" }).ok).toBe(false);
    expect(attrColumns({ loadIndex: "91" }).ok).toBe(false);
    expect(attrColumns({ tyreSize: "205/55 R16" }, "service").ok).toBe(false);
    expect(attrColumns({ tyreSize: "205/55 R16", speedRating: "VV" }).ok).toBe(false);
  });
  it("blank everything = no brand, no size", () => {
    expect(attrColumns({})).toEqual({ ok: true, columns: { brand: null, tyre_width: null, tyre_profile: null, tyre_rim: null, tyre_load_index: null, tyre_speed_rating: null } });
  });
});

describe("planImportedAttrs", () => {
  it("ignores a sheet without the columns", () => {
    expect(planImportedAttrs([{ sku: "A1", name: "Wax" }])).toEqual({ updates: [], errors: [] });
  });
  it("brand-only sheet touches brand only", () => {
    const p = planImportedAttrs([{ sku: "A1", name: "Wax", brand: "Meguiar's" }]);
    expect(p.updates).toEqual([{ sku: "A1", name: "Wax", columns: { brand: "Meguiar's" } }]);
  });
  it("a blank cell clears; a bad size is reported, not applied", () => {
    const p = planImportedAttrs([
      { sku: "", name: "Tyre A", brand: "", tyre_size: "", load_index: "", speed_rating: "" },
      { sku: "T2", name: "Tyre B", brand: "Pirelli", tyre_size: "205/55", load_index: "", speed_rating: "" },
      { sku: "T3", name: "Tyre C", brand: "Pirelli", tyre_size: "225/45 R17", load_index: "94", speed_rating: "Y" },
    ]);
    expect(p.updates).toEqual([
      { sku: "", name: "Tyre A", columns: { brand: null, tyre_width: null, tyre_profile: null, tyre_rim: null, tyre_load_index: null, tyre_speed_rating: null } },
      { sku: "T3", name: "Tyre C", columns: { brand: "Pirelli", tyre_width: 225, tyre_profile: 45, tyre_rim: 17, tyre_load_index: "94", tyre_speed_rating: "Y" } },
    ]);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toMatchObject({ sku: "T2", name: "Tyre B" });
  });
  it("matches by SKU, and by name only when the row has no SKU", () => {
    const bySku = new Map([["T3", "id-3"]]);
    const byName = new Map([["tyre a", "id-a"], ["tyre c", "id-c-by-name"]]);
    expect(resolveImportedRow({ sku: "T3", name: "Tyre C" }, bySku, byName)).toBe("id-3");
    expect(resolveImportedRow({ sku: "T9", name: "Tyre A" }, bySku, byName)).toBeNull();
    expect(resolveImportedRow({ sku: "", name: "TYRE A" }, bySku, byName)).toBe("id-a");
  });
});
