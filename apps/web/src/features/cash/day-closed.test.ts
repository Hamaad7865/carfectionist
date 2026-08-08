import { describe, expect, it } from "vitest";
import { isDayClosed } from "./day-closed";

/**
 * The same cases as the Android DayClosedRefusalTest, against the same server strings —
 * if the two ever disagree, one platform offers a way out of a sealed day and the other
 * leaves staff stuck, which is exactly the split this feature exists to close.
 */
describe("isDayClosed", () => {
  it("recognises the sealed-day refusal", () => {
    expect(isDayClosed("the day of 2026-08-08 is closed — reopen it before taking any more money")).toBe(true);
  });

  it("ignores a till left open since yesterday", () => {
    expect(
      isDayClosed(
        "this till is still on the day of 2026-08-07 — close that service on the till, " +
          "then open a new one, before taking today's money",
      ),
    ).toBe(false);
  });

  it("ignores the mid-sale day-closed refusal", () => {
    expect(isDayClosed("the day is closed — no more entries or transactions are possible")).toBe(false);
  });

  it("ignores an already-open till", () => {
    expect(isDayClosed("this till is already open")).toBe(false);
  });

  it("ignores a quotation-only device", () => {
    expect(isDayClosed("this device does not take payments — open the till on the paying terminal")).toBe(false);
  });

  it("ignores an uncounted float", () => {
    expect(isDayClosed("count the opening float before opening the till")).toBe(false);
  });

  it("offers nothing without an error", () => {
    expect(isDayClosed(null)).toBe(false);
    expect(isDayClosed(undefined)).toBe(false);
    expect(isDayClosed("")).toBe(false);
  });
});
