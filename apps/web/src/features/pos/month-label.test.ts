import { describe, expect, it } from "vitest";
import { monthLabel } from "./month-label";

// This module must stay server-safe (no "use client") — the /point-of-sale
// server page calls it. See month-label.ts header.
describe("monthLabel", () => {
  it("labels a closed period", () => {
    expect(monthLabel("2026-06")).toBe("June 2026");
    expect(monthLabel("2025-12")).toBe("December 2025");
  });
  it("falls back to the raw period on a junk month", () => {
    expect(monthLabel("2026-13")).toBe("2026-13 2026");
  });
});
