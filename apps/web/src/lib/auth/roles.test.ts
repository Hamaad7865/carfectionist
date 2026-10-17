import { describe, it, expect } from "vitest";
import { effectiveModules, hasModule, navForUser, defaultModulesForRole, TOGGLEABLE_MODULES, groupNav, NAV, NAV_GROUPS } from "./roles";

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

  it("gates Sales Journal like the rest of accounting", () => {
    // It shows the shop's takings by till and by user — same floor as Reports.
    expect(hasModule("owner", [], "/sales-journal")).toBe(true);
    expect(hasModule("manager", null, "/sales-journal")).toBe(true);
    expect(hasModule("accountant", null, "/sales-journal")).toBe(true);
    expect(hasModule("cashier", null, "/sales-journal")).toBe(false);
    expect(hasModule("technician", null, "/sales-journal")).toBe(false);
    // …and the owner can still revoke it from one user
    expect(hasModule("manager", ["/reports"], "/sales-journal")).toBe(false);
  });

  it("offers Sales Journal in the per-user module toggles", () => {
    expect(TOGGLEABLE_MODULES.some((m) => m.href === "/sales-journal")).toBe(true);
  });

  it("gates Reconciliation like the rest of accounting", () => {
    // Who owes what and when they paid — same floor as Reports.
    expect(hasModule("owner", [], "/reconciliation")).toBe(true);
    expect(hasModule("manager", null, "/reconciliation")).toBe(true);
    expect(hasModule("accountant", null, "/reconciliation")).toBe(true);
    expect(hasModule("cashier", null, "/reconciliation")).toBe(false);
    expect(hasModule("technician", null, "/reconciliation")).toBe(false);
    // …and the owner can still revoke it from one user
    expect(hasModule("manager", ["/reports"], "/reconciliation")).toBe(false);
  });

  it("offers Reconciliation in the per-user module toggles", () => {
    expect(TOGGLEABLE_MODULES.some((m) => m.href === "/reconciliation")).toBe(true);
  });
});

describe("sidebar groups", () => {
  it("files every module under a known group", () => {
    const known = new Set(NAV_GROUPS.map((g) => g.key));
    for (const item of NAV) expect(known.has(item.group)).toBe(true);
  });

  it("keeps Dashboard on its own at the top", () => {
    const sections = groupNav(navForUser("owner", null));
    expect(sections[0].label).toBeNull();
    expect(sections[0].items.map((i) => i.href)).toEqual(["/dashboard"]);
  });

  it("drops a group the user has nothing in", () => {
    // A technician sees Jobs and Certificates, never Finance or Admin.
    const labels = groupNav(navForUser("technician", null)).map((s) => s.label);
    expect(labels).not.toContain("Finance");
    expect(labels).not.toContain("Admin");
    expect(labels).toContain("Workshop");
  });

  it("loses no module in the grouping", () => {
    const flat = navForUser("owner", null);
    const grouped = groupNav(flat).flatMap((s) => s.items);
    expect(grouped).toHaveLength(flat.length);
  });
});
