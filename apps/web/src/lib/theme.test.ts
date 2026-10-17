import { describe, expect, it } from "vitest";
import { parseTheme, THEME_INIT_SCRIPT } from "./theme";

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
});
