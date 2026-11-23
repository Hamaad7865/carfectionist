import { describe, expect, it } from "vitest";
import { DETAILING_CHECKLIST, TYRE_CHECKLIST, shouldSwapForTyre } from "./checklist";

describe("shouldSwapForTyre", () => {
  it("swaps an empty or untouched detailing checklist", () => {
    expect(shouldSwapForTyre([])).toBe(true);
    expect(shouldSwapForTyre(null)).toBe(true);
    expect(shouldSwapForTyre(DETAILING_CHECKLIST.map((c) => ({ ...c })))).toBe(true);
  });
  it("never touches work already ticked or edited", () => {
    const ticked = DETAILING_CHECKLIST.map((c, i) => ({ ...c, done: i === 0 }));
    expect(shouldSwapForTyre(ticked)).toBe(false);
    expect(shouldSwapForTyre([{ label: "Custom step", done: false }])).toBe(false);
    expect(shouldSwapForTyre(TYRE_CHECKLIST)).toBe(false);
  });
});
