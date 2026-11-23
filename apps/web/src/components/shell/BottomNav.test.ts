import { describe, expect, it } from "vitest";
import { navForUser } from "@/lib/auth/roles";
import { bottomTabs } from "./BottomNav";

const tabs = (role: Parameters<typeof navForUser>[0]) =>
  bottomTabs(navForUser(role, null)).map((t) => t.href);

describe("bottomTabs — the phone tab bar", () => {
  it("gives the owner Home, Jobs, Sales, Reports", () => {
    expect(tabs("owner")).toEqual(["/dashboard", "/jobs", "/sales", "/reports"]);
  });

  it("gives a cashier the next pages they can open instead of Reports", () => {
    expect(tabs("cashier")).toEqual(["/dashboard", "/jobs", "/sales", "/contacts"]);
  });

  it("never offers a page the role cannot open", () => {
    for (const role of ["owner", "manager", "cashier", "technician", "accountant"] as const) {
      const allowed = navForUser(role, null).map((i) => i.href);
      const picked = tabs(role);
      expect(picked.length).toBeLessThanOrEqual(4);
      for (const href of picked) expect(allowed).toContain(href);
    }
  });

  it("fills up from the rest of the menu when the preferred pages run out", () => {
    // A technician sees Dashboard, Jobs and Certificates only.
    expect(tabs("technician")).toEqual(["/dashboard", "/jobs", "/certificates"]);
  });
});
