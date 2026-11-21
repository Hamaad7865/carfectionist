import { describe, expect, it } from "vitest";
import { fitSplitToTotal, planSplit } from "./split";

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

describe("fitSplitToTotal", () => {
  const plan = (cashTendered: number | null) => {
    const r = planSplit(
      [
        { method: "card", amountCents: 618000 },
        { method: "cash", amountCents: 1000000, tenderedCents: cashTendered },
      ],
      1618000,
      "sale-1",
    );
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("records the plan unchanged when the invoice matches", () => {
    const r = fitSplitToTotal(plan(1050000), 1618000);
    expect(r).toEqual({ ok: true, changeCents: 50000, payments: plan(1050000).payments });
  });

  it("lets the last part absorb a cent of rounding, so the invoice is settled exactly", () => {
    const up = fitSplitToTotal(plan(1050000), 1618001);
    expect(up.ok && up.payments.map((p) => p.amount)).toEqual([6180, 10000.01]);
    // Same cash in hand, one cent less change.
    expect(up.ok && [up.payments[1].tendered, up.changeCents]).toEqual([10500, 49999]);

    const down = fitSplitToTotal(plan(null), 1617999);
    expect(down.ok && down.payments.map((p) => p.amount)).toEqual([6180, 9999.99]);
    expect(down.ok && down.changeCents).toBe(0);
  });

  it("never lets the cash handed over fall below its part", () => {
    const r = fitSplitToTotal(plan(1000000), 1618001);
    expect(r.ok && [r.payments[1].amount, r.payments[1].tendered, r.changeCents]).toEqual([10000.01, 10000.01, 0]);
  });

  it("keeps the replay keys, so a retry records the same amounts under the same keys", () => {
    const a = fitSplitToTotal(plan(null), 1618001);
    const b = fitSplitToTotal(plan(null), 1618001);
    expect(a).toEqual(b);
    expect(a.ok && a.payments.map((p) => p.idempotencyKey)).toEqual(["sale-1:pay:0", "sale-1:pay:1"]);
  });

  it("records nothing when the gap is more than the last part can take", () => {
    const r = fitSplitToTotal(plan(null), 600000);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("Nothing was charged") });
  });
});
