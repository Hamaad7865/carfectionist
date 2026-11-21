import { describe, expect, it } from "vitest";
import { planSplit } from "./split";

describe("planSplit", () => {
  it("records each part under its own replayable key, cash change from the cash part only", () => {
    const r = planSplit(
      [
        { method: "cash", amountCents: 1000000, tenderedCents: 1050000 },
        { method: "card", amountCents: 618000, externalRef: " 4412 " },
      ],
      1618000,
      "sale-1",
    );
    expect(r).toEqual({
      ok: true,
      changeCents: 50000,
      payments: [
        { method: "cash", amount: 10000, tendered: 10500, externalRef: null, idempotencyKey: "sale-1:pay:0" },
        { method: "card", amount: 6180, tendered: null, externalRef: "4412", idempotencyKey: "sale-1:pay:1" },
      ],
    });
  });

  it("refuses parts that do not add up to the invoice, either way", () => {
    expect(planSplit([{ method: "card", amountCents: 100 }, { method: "juice", amountCents: 100 }], 250, "k")).toMatchObject({ ok: false, error: expect.stringContaining("short") });
    expect(planSplit([{ method: "card", amountCents: 200 }, { method: "juice", amountCents: 100 }], 250, "k")).toMatchObject({ ok: false, error: expect.stringContaining("over") });
  });

  it("refuses a single part, an empty part, two cash parts and short cash", () => {
    expect(planSplit([{ method: "card", amountCents: 250 }], 250, "k").ok).toBe(false);
    expect(planSplit([{ method: "card", amountCents: 250 }, { method: "juice", amountCents: 0 }], 250, "k").ok).toBe(false);
    expect(planSplit([{ method: "cash", amountCents: 100 }, { method: "cash", amountCents: 150 }], 250, "k").ok).toBe(false);
    expect(planSplit([{ method: "cash", amountCents: 100, tenderedCents: 50 }, { method: "card", amountCents: 150 }], 250, "k").ok).toBe(false);
  });

  it("falls back to COUNTER for card, Juice and bank, and keeps an unkeyed sale unkeyed", () => {
    const r = planSplit([{ method: "juice", amountCents: 100 }, { method: "bank_transfer", amountCents: 150 }], 250, null);
    expect(r.ok && r.payments.map((p) => [p.externalRef, p.idempotencyKey])).toEqual([
      ["COUNTER", null],
      ["COUNTER", null],
    ]);
  });
});
