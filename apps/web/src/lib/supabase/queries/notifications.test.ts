import { describe, it, expect } from "vitest";
import { applyDismissals, type Dismissal, type NotifItem } from "./notifications";

// The bell shows live CONDITIONS, not messages. So "dismiss" can never mean
// delete — the alert is recomputed from the ledger every time and would just
// come back. These are the rules that make clearing it mean something.

const alert = (over: Partial<NotifItem> = {}): NotifItem => ({
  key: "lowstock",
  label: "11 products low at the shop",
  detail: "Restock from the warehouse",
  href: "/products?tab=inventory",
  tone: "warn",
  count: 11,
  ...over,
});

const seen = (over: Partial<Dismissal> = {}): Dismissal => ({ key: "lowstock", seenCount: 11, day: "2026-07-16", ...over });

const TODAY = "2026-07-16";
const keys = (items: NotifItem[]) => items.map((i) => i.key);

describe("applyDismissals", () => {
  it("shows an alert nobody has cleared", () => {
    expect(keys(applyDismissals([alert()], [], TODAY))).toEqual(["lowstock"]);
  });

  it("hides one cleared today at the same size", () => {
    expect(applyDismissals([alert()], [seen()], TODAY)).toEqual([]);
  });

  it("brings it back tomorrow — a new day deserves the reminder again", () => {
    expect(keys(applyDismissals([alert()], [seen({ day: "2026-07-15" })], TODAY))).toEqual(["lowstock"]);
  });

  it("brings it back when it GROWS — a 4th enquiry after clearing 3 is news", () => {
    const enquiries = alert({ key: "enquiries", count: 4 });
    expect(keys(applyDismissals([enquiries], [seen({ key: "enquiries", seenCount: 3 })], TODAY))).toEqual(["enquiries"]);
  });

  it("keeps it hidden when it SHRINKS — paying 1 of 5 invoices is you working the list", () => {
    const invoices = alert({ key: "outstanding", count: 4 });
    expect(applyDismissals([invoices], [seen({ key: "outstanding", seenCount: 5 })], TODAY)).toEqual([]);
  });

  it("clears each alert independently", () => {
    const items = [alert(), alert({ key: "enquiries", count: 2 })];
    expect(keys(applyDismissals(items, [seen()], TODAY))).toEqual(["enquiries"]);
  });

  it("ignores a dismissal for an alert that no longer exists", () => {
    expect(keys(applyDismissals([alert()], [seen({ key: "reminders" })], TODAY))).toEqual(["lowstock"]);
  });

  it("a zero-count alert cleared at zero stays cleared", () => {
    // guards the boundary: `count > seenCount` must not be `>=`
    const a = alert({ count: 0 });
    expect(applyDismissals([a], [seen({ seenCount: 0 })], TODAY)).toEqual([]);
  });
});
