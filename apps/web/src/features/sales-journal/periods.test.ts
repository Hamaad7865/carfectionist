import { describe, it, expect } from "vitest";
import {
  addDays, addMonths, daysInMonth, lengthInDays,
  rangeForPreset, presetForRange, comparisonRange,
  rangeLabel, shortRangeLabel,
} from "./periods";

// The reference case throughout is the owner's Cashmag screenshot: a 28–29 July
// 2026 range, whose comparison options read 26–27 July, 28–29 June, 28–29 July.

const REF = { from: "2026-07-28", to: "2026-07-29" };

describe("day arithmetic", () => {
  it("adds and subtracts days across a month boundary", () => {
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("counts an inclusive range", () => {
    expect(lengthInDays(REF)).toBe(2);
    expect(lengthInDays({ from: "2026-07-28", to: "2026-07-28" })).toBe(1);
    expect(lengthInDays({ from: "2026-07-01", to: "2026-07-31" })).toBe(31);
  });

  it("knows month lengths, leap years included", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 7)).toBe(31);
  });
});

describe("addMonths — clamping", () => {
  it("clamps a long month onto a short one", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2028-03-31", -1)).toBe("2028-02-29"); // leap year
    expect(addMonths("2026-05-31", -1)).toBe("2026-04-30");
  });

  it("crosses the year boundary in both directions", () => {
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-07-28", -12)).toBe("2025-07-28");
  });

  it("does not drift on a plain month step", () => {
    expect(addMonths("2026-07-28", -1)).toBe("2026-06-28");
  });
});

describe("presets", () => {
  const TODAY = "2026-07-29";

  it("resolves each preset", () => {
    expect(rangeForPreset("today", TODAY)).toEqual({ from: "2026-07-29", to: "2026-07-29" });
    expect(rangeForPreset("yesterday", TODAY)).toEqual({ from: "2026-07-28", to: "2026-07-28" });
    expect(rangeForPreset("current-month", TODAY)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(rangeForPreset("previous-month", TODAY)).toEqual({ from: "2026-06-01", to: "2026-06-30" });
  });

  it("gets February's end right when the previous month is short", () => {
    expect(rangeForPreset("previous-month", "2026-03-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(rangeForPreset("previous-month", "2028-03-15")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("recognises a range as its preset, so the dropdown matches the URL", () => {
    expect(presetForRange({ from: "2026-07-29", to: "2026-07-29" }, TODAY)).toBe("today");
    expect(presetForRange({ from: "2026-07-01", to: "2026-07-31" }, TODAY)).toBe("current-month");
    expect(presetForRange(REF, TODAY)).toBe("custom");
  });
});

describe("comparison ranges", () => {
  it("matches Cashmag for the reference period", () => {
    expect(comparisonRange("none", REF)).toBeNull();
    expect(comparisonRange("previous-period", REF)).toEqual({ from: "2026-07-26", to: "2026-07-27" });
    expect(comparisonRange("previous-month", REF)).toEqual({ from: "2026-06-28", to: "2026-06-29" });
    expect(comparisonRange("previous-year", REF)).toEqual({ from: "2025-07-28", to: "2025-07-29" });
  });

  it("puts the previous period immediately before, never overlapping", () => {
    const month = { from: "2026-07-01", to: "2026-07-31" };
    expect(comparisonRange("previous-period", month)).toEqual({ from: "2026-05-31", to: "2026-06-30" });
    // …and it is the same length as the range it compares
    expect(lengthInDays(comparisonRange("previous-period", month)!)).toBe(lengthInDays(month));
  });

  it("compares a single day against the day before", () => {
    const one = { from: "2026-07-29", to: "2026-07-29" };
    expect(comparisonRange("previous-period", one)).toEqual({ from: "2026-07-28", to: "2026-07-28" });
  });

  it("clamps a month-end range shifted onto February", () => {
    expect(comparisonRange("previous-month", { from: "2026-03-30", to: "2026-03-31" })).toEqual({
      from: "2026-02-28",
      to: "2026-02-28",
    });
  });
});

describe("labels", () => {
  it("renders the period header the way Cashmag does", () => {
    expect(rangeLabel(REF)).toBe("28 JULY 2026 – 29 JULY 2026");
    expect(rangeLabel({ from: "2026-07-29", to: "2026-07-29" })).toBe("29 JULY 2026");
  });

  it("renders the compact form beside a comparison option", () => {
    expect(shortRangeLabel(REF)).toBe("28 Jul – 29 Jul 2026");
    expect(shortRangeLabel({ from: "2026-07-29", to: "2026-07-29" })).toBe("29 Jul 2026");
    expect(shortRangeLabel({ from: "2025-12-30", to: "2026-01-02" })).toBe("30 Dec 2025 – 2 Jan 2026");
  });
});
