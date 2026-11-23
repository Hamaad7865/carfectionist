import { describe, expect, it } from "vitest";
import { formatTyreSize, parseTyreName, parseTyreSize, saleCategory, sameSize } from "./tyre-size";

describe("parseTyreSize", () => {
  it.each([
    ["195/65R15", { width: 195, profile: 65, rim: 15 }],
    ["195/65 R15", { width: 195, profile: 65, rim: 15 }],
    ["225/45ZR17 94W", { width: 225, profile: 45, rim: 17 }],
    ["205 55 R 16", { width: 205, profile: 55, rim: 16 }],
    ["235/60-18", { width: 235, profile: 60, rim: 18 }],
  ])("reads %s", (text, size) => expect(parseTyreSize(text)).toEqual(size));

  it("ignores things that only look like sizes", () => {
    expect(parseTyreSize("Varta Blue 60Ah D24")).toBeNull();
    expect(parseTyreSize("Wiper 24")).toBeNull();
    expect(parseTyreSize("Order 400/12 R99")).toBeNull();
    expect(parseTyreSize(null)).toBeNull();
  });
});

describe("parseTyreName", () => {
  it("splits brand, model, size and load index", () => {
    expect(parseTyreName("Bridgestone Ecopia EP150 195/65R15 91H")).toEqual({
      brand: "Bridgestone",
      model: "Ecopia EP150",
      size: { width: 195, profile: 65, rim: 15 },
      load: "91H",
    });
  });

  it("keeps words after the size in the model and copes with no brand", () => {
    expect(parseTyreName("Michelin 195/65R15 91T Energy Saver+")?.model).toBe("Energy Saver+");
    expect(parseTyreName("Ecopia 195/65R15")).toMatchObject({ brand: "", model: "Ecopia", load: null });
    expect(parseTyreName("Tubeless valve TR414")).toBeNull();
  });
});

describe("saleCategory", () => {
  it("files services, tyres (by category or size) and everything else as parts", () => {
    expect(saleCategory({ kind: "service", name: "Wheel alignment", category: "Tyres" })).toBe("services");
    expect(saleCategory({ kind: "product", name: "Ecopia EP150", category: "Tyres" })).toBe("tyres");
    expect(saleCategory({ kind: "product", name: "Kinergy Eco 2 195/65R15 91H", category: null })).toBe("tyres");
    expect(saleCategory({ kind: "consumable", name: "Tubeless valve TR414", category: "Valves" })).toBe("parts");
  });
});

describe("formatTyreSize / sameSize", () => {
  it("writes the trade form and compares by value", () => {
    expect(formatTyreSize({ width: 195, profile: 65, rim: 15 })).toBe("195/65 R15");
    expect(sameSize(parseTyreSize("195/65R15"), parseTyreSize("195/65 R15"))).toBe(true);
    expect(sameSize(parseTyreSize("195/65R15"), null)).toBe(false);
  });
});
