import { describe, expect, it } from "vitest";
import { breadcrumbTrail, isActiveHref, tyreCentreNav } from "./nav";

/** Any shop that isn't a tyre centre keeps every module; Garage De L'Est is the tyre centre. */
const SHOP = "11111111-1111-4111-8111-000000000001";
const TYRE = "1f060b86-ad63-4dc7-93fb-a1fdfae18b27";

const keys = (links: { key: string }[]) => links.map((l) => l.key);

describe("tyreCentreNav", () => {
  it("gives an owner the whole design menu, the till and every other module under More", () => {
    const nav = tyreCentreNav("owner", null, SHOP);
    expect(keys(nav.shopFloor)).toEqual(["overview", "new-sale", "jobs", "customers", "documents", "stock", "reports"]);
    expect(keys(nav.till)).toEqual(["drawer", "close-day"]);
    expect(nav.more.map((m) => m.href)).toContain("/activity");
    expect(nav.more.map((m) => m.href)).not.toContain("/sales");
    expect(nav.settings?.href).toBe("/settings");
  });

  it("keeps a cashier off reports, the till and settings", () => {
    const nav = tyreCentreNav("cashier", null, SHOP);
    expect(keys(nav.shopFloor)).not.toContain("reports");
    expect(nav.till).toEqual([]);
    expect(nav.settings).toBeNull();
  });

  it("follows a per-user module override, keeping Overview", () => {
    const nav = tyreCentreNav("manager", ["/jobs"], SHOP);
    expect(keys(nav.shopFloor)).toEqual(["overview", "jobs"]);
    expect(nav.till).toEqual([]);
    expect(nav.more).toEqual([]);
  });

  it("drops Messages, Marketing, Certificates and Enquiries for the tyre centre", () => {
    const shop = tyreCentreNav("owner", null, SHOP).more.map((m) => m.href);
    expect(shop).toEqual(expect.arrayContaining(["/messages", "/marketing"]));
    const tyre = tyreCentreNav("owner", null, TYRE).more.map((m) => m.href);
    for (const href of ["/messages", "/marketing", "/certificates", "/enquiries"]) expect(tyre).not.toContain(href);
    expect(tyre).toContain("/activity");
  });
});

describe("breadcrumbTrail", () => {
  const nav = tyreCentreNav("owner", null, SHOP);
  it("walks shop → menu row → record, linking all but the page you are on", () => {
    expect(breadcrumbTrail("/dashboard", nav, "Tyre Centre Ltd")).toEqual([{ label: "Tyre Centre Ltd", href: "/dashboard" }, { label: "Overview" }]);
    expect(breadcrumbTrail("/sales/counter", nav, "TC")).toEqual([{ label: "TC", href: "/dashboard" }, { label: "New sale" }]);
    expect(breadcrumbTrail("/sales/0b8f6a2e-1c1d-4e7f-9a1b-2c3d4e5f6a7b/edit", nav, "TC")).toEqual([
      { label: "TC", href: "/dashboard" },
      { label: "Documents", href: "/sales" },
      { label: "Details" },
      { label: "Edit" },
    ]);
    expect(breadcrumbTrail("/activity", nav, "TC").at(-1)).toEqual({ label: "Activity" });
  });
});

describe("isActiveHref", () => {
  it("lights New sale, not Documents, on the counter", () => {
    expect(isActiveHref("/sales/counter", "/sales/counter")).toBe(true);
    expect(isActiveHref("/sales/counter", "/sales")).toBe(false);
    expect(isActiveHref("/sales/abc", "/sales")).toBe(true);
    expect(isActiveHref("/sales", "/sales?type=quote")).toBe(true);
    expect(isActiveHref("/salesjournal", "/sales")).toBe(false);
  });
});
