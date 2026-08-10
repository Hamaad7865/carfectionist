import { describe, expect, it } from "vitest";
import { methodLabelFor } from "./method-label";

describe("methodLabelFor", () => {
  it("the owner's scenario: wrong method reversed, then repaid → the real method, not Split", () => {
    expect(
      methodLabelFor([
        { method: "juice", amount: 3080 },          // operator's mistake
        { method: "juice", amount: -3080 },         // reversal
        { method: "bank_transfer", amount: 3080 },  // actual payment
      ]),
    ).toBe("Bank");
  });
  it("a genuine split stays Split", () => {
    expect(methodLabelFor([{ method: "cash", amount: 50000 }, { method: "card", amount: 38780 }])).toBe("Split");
  });
  it("single method", () => {
    expect(methodLabelFor([{ method: "card", amount: 5445 }])).toBe("Card");
  });
  it("points is its own label, not left showing the raw method", () => {
    expect(methodLabelFor([{ method: "points", amount: 5000 }])).toBe("Points");
  });
  it("everything reversed → back to unpaid dash", () => {
    expect(methodLabelFor([{ method: "cash", amount: 100 }, { method: "cash", amount: -100 }])).toBe("—");
  });
  it("no payments", () => {
    expect(methodLabelFor([])).toBe("—");
  });
});
