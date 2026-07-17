import { describe, expect, it } from "vitest";
import { muDate, muDateTime, muDayLabel } from "./mu-date";

describe("muDayLabel", () => {
  it("writes the Mauritius day out in full", () => {
    // 2026-07-17 is a Friday.
    expect(muDayLabel("2026-07-17T10:00:00Z")).toBe("Friday 17 July 2026");
  });

  it("rolls a late-UTC event onto the next MU day", () => {
    // 20:12 UTC = 00:12 MU the following morning — the sale made "tonight"
    // must appear under tomorrow's header, matching muDate's bucketing.
    expect(muDayLabel("2026-07-16T20:12:00Z")).toBe("Friday 17 July 2026");
    expect(muDate("2026-07-16T20:12:00Z")).toBe("2026-07-17");
    expect(muDateTime("2026-07-16T20:12:00Z")).toBe("2026-07-17 00:12");
  });

  it("keeps an early-UTC event on the same MU day", () => {
    expect(muDayLabel("2026-01-01T05:00:00Z")).toBe("Thursday 1 January 2026");
  });
});
