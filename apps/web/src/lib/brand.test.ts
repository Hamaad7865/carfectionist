import { describe, expect, it } from "vitest";
import { brandForHost, brandForShop, CARFECTIONIST, HAZ } from "./brand";

describe("brandForHost", () => {
  it("presents HAZ Software on the hazsoftware.com demo host", () => {
    expect(brandForHost("app.hazsoftware.com").key).toBe("haz");
    expect(brandForHost("APP.HazSoftware.com:443").key).toBe("haz");
  });
  it("keeps Carfectionist everywhere else, including a missing host", () => {
    expect(brandForHost("app-carfectionist.com").key).toBe("carfectionist");
    expect(brandForHost("localhost:3000").key).toBe("carfectionist");
    expect(brandForHost(null).key).toBe("carfectionist");
    expect(brandForHost("evilhazsoftware.com").key).toBe("carfectionist");
  });
  it("presents the tyre centre on its own host, ahead of the HAZ wildcard", () => {
    expect(brandForHost("tyrecentre.hazsoftware.com").key).toBe("tyrecentre");
    expect(brandForHost("TyreCentre.HazSoftware.com:443").key).toBe("tyrecentre");
    expect(brandForHost("tyrecentre.localhost:3000").key).toBe("tyrecentre");
    expect(brandForHost("x.tyrecentre.hazsoftware.com").key).toBe("haz");
  });
  it("shows no Carfectionist text in the tyre-centre brand", () => {
    const { logoSrc, ...text } = brandForHost("tyrecentre.hazsoftware.com");
    expect(logoSrc).toBeNull();
    expect(JSON.stringify(text).toLowerCase()).not.toContain("carfection");
  });
  it("shows no Carfectionist text in the HAZ brand", () => {
    const { logoSrc, ...text } = brandForHost("app.hazsoftware.com");
    expect(logoSrc).toBeNull();
    expect(JSON.stringify(text).toLowerCase()).not.toContain("carfection");
  });
});

describe("brandForShop", () => {
  it("keeps the host's brand for the Carfectionist shop and its sandbox", () => {
    expect(brandForShop(CARFECTIONIST, "11111111-1111-4111-8111-000000000001", "x")).toBe(CARFECTIONIST);
    expect(brandForShop(HAZ, "22222222-2222-4222-8222-000000000002", "x")).toBe(HAZ);
  });
  it("shows another shop its own name and nothing of Carfectionist, even on the Carfectionist host", () => {
    const b = brandForShop(CARFECTIONIST, "1f060b86-ad63-4dc7-93fb-a1fdfae18b27", " Garage De L'Est LTEE ");
    expect(b.name).toBe("Garage De L'Est LTEE");
    expect(b.key).toBe("shop");
    expect(b.logoSrc).toBeNull();
    expect(JSON.stringify(b).toLowerCase()).not.toContain("carfection");
  });
  it("falls back to HAZ Software when the shop has no name", () => {
    expect(brandForShop(CARFECTIONIST, "other", null).name).toBe("HAZ Software");
  });
});
