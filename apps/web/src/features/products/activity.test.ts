import { describe, it, expect } from "vitest";
import { toActivityView, shortWhen, type ActivityRow } from "./activity";

const base: ActivityRow = {
  eventId: "e1",
  happenedAt: "2026-07-30T14:02:00Z",
  qty: -2,
  source: "movement",
  kind: "invoice",
  refId: "doc-1",
  locationName: "Shop",
  docNumber: "INV-0042",
  partyName: "Sylvio Ramdin",
  note: "sale on issue",
  actorName: "Anesh",
};
const row = (over: Partial<ActivityRow>): ActivityRow => ({ ...base, ...over });

describe("catalogue history rows", () => {
  it("shows a sale as its invoice number, linked to the invoice", () => {
    const v = toActivityView(row({}));
    expect(v.label).toBe("INV-0042");
    expect(v.href).toBe("/sales/doc-1");
    expect(v.detail).toBe("Sylvio Ramdin");
    expect(v.qty).toBe("−2");
    expect(v.tone).toBe("out");
  });

  it("shows a refund as its credit note, stock coming back in", () => {
    const v = toActivityView(row({ kind: "credit_note", docNumber: "CN-0007", qty: 1 }));
    expect(v.label).toBe("CN-0007");
    expect(v.href).toBe("/sales/doc-1");
    expect(v.qty).toBe("+1");
    expect(v.tone).toBe("in");
  });

  it("labels a job card the way the jobs list does, and links to it", () => {
    const v = toActivityView(row({ kind: "job_card", refId: "8dd6f1c2-0000-4000-8000-000000000000", docNumber: null, partyName: "ASG Car Wash" }));
    expect(v.label).toBe("JOB-8DD6");
    expect(v.href).toBe("/jobs/8dd6f1c2-0000-4000-8000-000000000000");
    expect(v.detail).toBe("ASG Car Wash");
  });

  // /purchases has no detail page, so a linked-looking PO would be a dead end.
  it("names the supplier on a purchase, without pretending it is a link", () => {
    const v = toActivityView(row({ kind: "purchase_order", qty: 24, docNumber: null, partyName: "Auto Parts Ltd" }));
    expect(v.label).toBe("Purchase");
    expect(v.href).toBeNull();
    expect(v.detail).toBe("Auto Parts Ltd");
  });

  it("reads a transfer from the side it is standing on", () => {
    const out = toActivityView(row({ kind: "transfer", qty: -5, locationName: "Warehouse", docNumber: null, partyName: "Shop", note: "transfer out" }));
    expect(out.detail).toBe("to Shop");
    expect(out.locationName).toBe("Warehouse");

    const inn = toActivityView(row({ kind: "transfer", qty: 5, locationName: "Shop", docNumber: null, partyName: "Warehouse", note: "transfer in" }));
    expect(inn.detail).toBe("from Warehouse");
  });

  // The reason is mandatory on an adjustment and it is the whole point of the row.
  it("shows an adjustment's reason, not the word 'adjustment' twice", () => {
    const v = toActivityView(row({ kind: "adjustment", qty: -12, refId: null, docNumber: null, partyName: null, note: "damaged in rack" }));
    expect(v.label).toBe("Adjustment");
    expect(v.detail).toBe("damaged in rack");
    expect(v.href).toBeNull();
  });

  // 'sale on issue' / 'PO receipt' etc. are boilerplate the RPC writes; only the
  // adjustment note was typed by a person.
  it("does not surface the ledger's own boilerplate notes", () => {
    expect(toActivityView(row({ partyName: null })).detail).toBeNull();
    expect(toActivityView(row({ kind: "purchase_order", qty: 3, partyName: null, note: "PO receipt" })).detail).toBeNull();
  });

  it("still links a sale whose number it could not read", () => {
    const v = toActivityView(row({ docNumber: null }));
    expect(v.label).toBe("Invoice");
    expect(v.href).toBe("/sales/doc-1");
  });

  it("counts a service instead of colouring it, since nothing moved", () => {
    const v = toActivityView(row({ source: "line", qty: 2, locationName: null, note: null }));
    expect(v.qty).toBe("×2");
    expect(v.tone).toBe("none");
    expect(v.label).toBe("INV-0042");
    expect(v.detail).toBe("Sylvio Ramdin");
  });

  it("keeps fractional quantities and drops trailing zeros", () => {
    expect(toActivityView(row({ qty: -2.5 })).qty).toBe("−2.5");
    expect(toActivityView(row({ qty: -2.0 })).qty).toBe("−2");
  });
});

describe("shortWhen", () => {
  it("reads the clock in Mauritius, not UTC", () => {
    expect(shortWhen("2026-07-30T14:02:00Z")).toBe("30 Jul 18:02");
  });

  // 21:30 UTC is already the next morning in Mauritius — the owner's day, not the
  // server's, is the one on the row.
  it("rolls over the date at Mauritius midnight", () => {
    expect(shortWhen("2026-07-30T21:30:00Z")).toBe("31 Jul 01:30");
  });
});
