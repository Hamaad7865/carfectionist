import { describe, expect, it } from "vitest";
import { brandForHost } from "./brand";

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
