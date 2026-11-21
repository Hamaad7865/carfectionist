import { describe, expect, it } from "vitest";
import { parseTheme, resolveTheme, THEME_INIT_SCRIPT, THEME_INIT_SCRIPT_SYSTEM } from "./theme";

describe("theme", () => {
  it("defaults to light for anything but an explicit dark choice", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme(null)).toBe("light");
    expect(parseTheme("system")).toBe("light");
  });

  it("ships a startup script that only ever turns dark on", () => {
    const html = { dataset: {} as Record<string, string> };
    const run = (saved: string | null) => {
      html.dataset = {};
      new Function("localStorage", "document", THEME_INIT_SCRIPT)(
        { getItem: () => saved },
        { documentElement: html },
      );
      return html.dataset.theme;
    };
    expect(run("dark")).toBe("dark");
    expect(run("light")).toBeUndefined();
    expect(run(null)).toBeUndefined();
  });

  it("survives blocked storage", () => {
    expect(() =>
      new Function("localStorage", "document", THEME_INIT_SCRIPT)(
        { getItem: () => { throw new Error("blocked"); } },
        { documentElement: { dataset: {} } },
      ),
    ).not.toThrow();
  });

  it("lets the tyre centre follow the computer until a choice is saved", () => {
    const run = (saved: string | null, systemDark: boolean) => {
      const html = { dataset: {} as Record<string, string> };
      new Function("localStorage", "document", "matchMedia", THEME_INIT_SCRIPT_SYSTEM)(
        { getItem: () => saved },
        { documentElement: html },
        () => ({ matches: systemDark }),
      );
      return html.dataset.theme;
    };
    expect(run(null, true)).toBe("dark");
    expect(run(null, false)).toBeUndefined();
    expect(run("light", true)).toBeUndefined();
    expect(run("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});
