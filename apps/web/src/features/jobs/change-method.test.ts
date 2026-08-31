import { describe, it, expect } from "vitest";
import { methodChangeTargets } from "./change-method";

describe("methodChangeTargets", () => {
  it("omits the current method", () => {
    expect(methodChangeTargets("card", { canManage: true })).not.toContain("card");
  });
  it("never offers points or credit", () => {
    const t = methodChangeTargets("card", { canManage: true });
    expect(t).not.toContain("points");
    expect(t).not.toContain("credit");
  });
  it("offers cash as a target for anyone", () => {
    expect(methodChangeTargets("card", { canManage: false })).toContain("cash");
  });
  it("a cashier gets no targets for a cash-source row (cannot change away from cash)", () => {
    expect(methodChangeTargets("cash", { canManage: false })).toEqual([]);
  });
  it("a manager can change a cash-source row", () => {
    expect(methodChangeTargets("cash", { canManage: true })).toContain("card");
  });
  it("points / credit source rows are never changeable", () => {
    expect(methodChangeTargets("points", { canManage: true })).toEqual([]);
    expect(methodChangeTargets("credit", { canManage: true })).toEqual([]);
  });
  it("a non-cash source keeps every other non-... method as a target", () => {
    expect(methodChangeTargets("juice", { canManage: false }).sort()).toEqual(
      ["bank_transfer", "card", "cash", "cheque"],
    );
  });
});
