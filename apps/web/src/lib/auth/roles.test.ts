import { describe, it, expect } from "vitest";
import { effectiveModules, hasModule, navForUser, defaultModulesForRole } from "./roles";

describe("per-user module access", () => {
  it("owner is always full-access, regardless of override", () => {
    expect(hasModule("owner", [], "/reports")).toBe(true);
    expect(hasModule("owner", ["/dashboard"], "/settings")).toBe(true);
    expect(navForUser("owner", []).length).toBe(navForUser("owner", null).length);
    expect(navForUser("owner", []).length).toBeGreaterThan(8);
  });

  it("null override falls back to the role's defaults", () => {
    expect(new Set(effectiveModules("technician", null))).toEqual(new Set(defaultModulesForRole("technician")));
    expect(hasModule("cashier", null, "/reports")).toBe(false); // cashier role excludes reports
    expect(hasModule("manager", null, "/reports")).toBe(true);
  });

  it("an explicit override narrows access; Dashboard always stays", () => {
    expect(hasModule("manager", ["/sales"], "/products")).toBe(false);
    expect(hasModule("manager", ["/sales"], "/sales")).toBe(true);
    expect(hasModule("manager", ["/sales"], "/dashboard")).toBe(true);
    expect(hasModule("manager", [], "/sales")).toBe(false);        // empty = dashboard only
    expect(hasModule("manager", [], "/dashboard")).toBe(true);
  });

  it("an override can widen beyond the role default", () => {
    expect(hasModule("technician", ["/sales", "/products"], "/sales")).toBe(true);
  });
});
