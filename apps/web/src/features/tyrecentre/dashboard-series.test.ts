import { describe, expect, it } from "vitest";
import { bucketByDay, muDayKeys, shortDay, windowSums } from "./dashboard-series";

// 22 Nov 2026, 00:30 in Mauritius = 21 Nov 20:30Z.
const NOW = Date.parse("2026-11-21T20:30:00Z");

describe("muDayKeys", () => {
  it("ends on today's Mauritius date, not the UTC one", () => {
    expect(muDayKeys(NOW, 3)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
  });
});

describe("bucketByDay", () => {
  it("files each row on its Mauritius day and drops what falls outside", () => {
    const keys = muDayKeys(NOW, 2); // 21, 22 Nov
    const rows = [
      { at: "2026-11-21T19:59:00Z", value: 100 }, // 23:59 MU, the 21st
      { at: "2026-11-21T20:01:00Z", value: 50 }, // 00:01 MU, the 22nd
      { at: "2026-11-21T20:10:00Z", value: -20 }, // a credit note takes it back
      { at: "2026-11-01T08:00:00Z", value: 999 },
    ];
    expect(bucketByDay(keys, rows)).toEqual([100, 30]);
  });
});

describe("windowSums / shortDay", () => {
  it("compares the last n days with the n before them", () => {
    expect(windowSums([1, 2, 3, 4, 5, 6], 2)).toEqual({ current: 11, previous: 7 });
    expect(windowSums([5], 2)).toEqual({ current: 5, previous: 0 });
    expect(shortDay("2026-11-02")).toBe("2 Nov");
  });
});
