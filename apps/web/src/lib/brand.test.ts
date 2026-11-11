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
  it("shows no Carfectionist text in the HAZ brand", () => {
    const { logoSrc, ...text } = brandForHost("app.hazsoftware.com");
    expect(logoSrc).toBeNull();
    expect(JSON.stringify(text).toLowerCase()).not.toContain("carfection");
  });
});
