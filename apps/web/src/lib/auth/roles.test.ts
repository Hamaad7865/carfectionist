import { describe, it, expect } from "vitest";
import { effectiveModules, hasModule, navForUser, defaultModulesForRole, TOGGLEABLE_MODULES, groupNav, NAV, NAV_GROUPS, hiddenModulesFor, hasWhatsApp, isTyreShop } from "./roles";

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

describe("hiddenModulesFor", () => {
  it("a tyre centre has no messages, marketing, certificates or enquiries", () => {
    expect(hiddenModulesFor("1f060b86-ad63-4dc7-93fb-a1fdfae18b27")).toEqual(["/messages", "/marketing", "/certificates", "/enquiries"]);
  });
  it("Carfectionist keeps every module", () => {
    expect(hiddenModulesFor("11111111-1111-4111-8111-000000000001")).toEqual([]);
  });
  it("the TEST tyre sandbox behaves like the tyre centre", () => {
    expect(hiddenModulesFor("44444444-4444-4444-8444-000000000004")).toEqual(["/messages", "/marketing", "/certificates", "/enquiries"]);
    expect(isTyreShop("44444444-4444-4444-8444-000000000004")).toBe(true);
    expect(hasWhatsApp("44444444-4444-4444-8444-000000000004")).toBe(false);
  });
});

describe("hasWhatsApp", () => {
  it("the tyre centre has none — the deployment's number is Carfectionist's", () => {
    expect(hasWhatsApp("1f060b86-ad63-4dc7-93fb-a1fdfae18b27")).toBe(false);
  });
  it("Carfectionist and its sandbox keep it", () => {
    expect(hasWhatsApp("11111111-1111-4111-8111-000000000001")).toBe(true);
    expect(hasWhatsApp("22222222-2222-4222-8222-000000000002")).toBe(true);
  });
  it("no session, no WhatsApp", () => {
    expect(hasWhatsApp(null)).toBe(false);
  });
});
