import { describe, expect, it } from "vitest";
import { buildDotChart, muDayStartMs, normalizeRange, overviewWindow, percentChange } from "./overview-model";

// Saturday 21 November 2026, 13:54 in Mauritius (UTC+4) = 09:54Z.
const NOW = Date.parse("2026-11-21T09:54:00Z");
const at = (muLocal: string) => Date.parse(`${muLocal}+04:00`);

describe("overviewWindow", () => {
  it("compares today with the same stretch of last Saturday, in Mauritius days", () => {
    const w = overviewWindow("today", NOW);
    expect(w.startMs).toBe(at("2026-11-21T00:00:00"));
    expect(w.endMs).toBe(NOW);
    expect(w.prevStartMs).toBe(at("2026-11-14T00:00:00"));
    expect(w.prevEndMs).toBe(at("2026-11-14T13:54:00"));
    expect(w.compareLabel).toBe("vs last Saturday");
  });

  it("counts 7 days as today and the six before, against the seven before that", () => {
    const w = overviewWindow("7d", NOW);
    expect(w.startMs).toBe(at("2026-11-15T00:00:00"));
    expect(w.prevStartMs).toBe(at("2026-11-08T00:00:00"));
    expect(w.prevEndMs).toBe(w.startMs);
  });

  it("puts 01:30 Mauritius on its own day, not the UTC day before", () => {
    expect(muDayStartMs(at("2026-11-21T01:30:00"))).toBe(at("2026-11-21T00:00:00"));
  });
});

describe("percentChange", () => {
  it("rounds to one decimal and refuses a zero base", () => {
    expect(percentChange(18435000, 16400000)).toBe(12.4);
    expect(percentChange(100, 0)).toBeNull();
  });
});

describe("buildDotChart", () => {
  it("drops each sale into its Mauritius hour and books only what is still to come", () => {
    const c = buildDotChart(
      "today",
      overviewWindow("today", NOW),
      [{ atMs: at("2026-11-21T08:10:00"), companyIndex: 0 }, { atMs: at("2026-11-21T13:20:00"), companyIndex: 1 }],
      [at("2026-11-21T15:00:00"), at("2026-11-21T09:00:00")],
      NOW,
    );
    expect(c.columns[0]).toMatchObject({ label: "08", sales: [0] });
    expect(c.columns.find((x) => x.label === "13")?.sales).toEqual([1]);
    expect(c.columns.find((x) => x.label === "15")?.booked).toBe(1);
    expect(c.columns.find((x) => x.label === "09")?.booked).toBe(0);
    expect(c.columns.at(-1)?.label).toBe("18");
    expect(c.nowLabel).toBe("13:54");
    expect(c.nowPos).toBeCloseTo(5 + 0.9 + 0.5);
  });

  it("widens the day for a sale at 19:00 and scales dots when a column overflows", () => {
    const sales = Array.from({ length: 30 }, () => ({ atMs: at("2026-11-21T19:05:00"), companyIndex: 0 }));
    const c = buildDotChart("today", overviewWindow("today", NOW), sales, [], NOW, 14);
    expect(c.columns.at(-1)?.label).toBe("19");
    expect(c.perDot).toBe(3);
  });

  it("uses one column per day for 7 days, ending on today", () => {
    const w = overviewWindow("7d", NOW);
    const c = buildDotChart("7d", w, [{ atMs: at("2026-11-15T10:00:00"), companyIndex: 0 }], [], NOW);
    expect(c.columns.map((x) => x.label)).toEqual(["SUN", "MON", "TUE", "WED", "THU", "FRI", "TODAY"]);
    expect(c.columns[0].sales).toEqual([0]);
    expect(c.nowPos).toBeNull();
  });
});

describe("normalizeRange", () => {
  it("falls back to today", () => {
    expect(normalizeRange("30d")).toBe("30d");
    expect(normalizeRange("year")).toBe("today");
    expect(normalizeRange(undefined)).toBe("today");
  });
});
