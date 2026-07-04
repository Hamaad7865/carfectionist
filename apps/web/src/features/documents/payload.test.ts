import { describe, it, expect } from "vitest";
import { toRpcLines, toRpcDoc, saveDraftInputSchema } from "./payload";

describe("toRpcLines (cents → rupees seam)", () => {
  it("converts unitCents to rupees and assigns sort order", () => {
    const out = toRpcLines([
      { productId: "p1", title: "Full Decon", qty: 1, unitCents: 3200000, vatRatePct: 15 },
      { productId: null, title: "Ad-hoc", qty: 4, unitCents: 380000, vatRatePct: 15, discountPct: 10 },
    ]);
    expect(out[0].unit_price).toBe(32000);
    expect(out[0].sort_order).toBe(0);
    expect(out[0].discount_pct).toBe(0);
    expect(out[1].unit_price).toBe(3800);
    expect(out[1].discount_pct).toBe(10);
    expect(out[1].product_id).toBeNull();
    expect(out[1].sort_order).toBe(1);
  });
});

describe("toRpcDoc", () => {
  it("defaults origin and template_overrides", () => {
    const d = toRpcDoc({ docType: "quote" });
    expect(d.origin).toBe("standalone");
    expect(d.template_overrides).toEqual({});
    expect(d.customer_id).toBeNull();
  });
});

describe("saveDraftInputSchema", () => {
  it("accepts a valid quote", () => {
    const r = saveDraftInputSchema.safeParse({
      doc: { docType: "quote", customerId: "c1" },
      lines: [{ productId: null, title: "X", qty: 1, unitCents: 1000, vatRatePct: 15 }],
    });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown doc_type", () => {
    const r = saveDraftInputSchema.safeParse({ doc: { docType: "receipt" }, lines: [] });
    expect(r.success).toBe(false);
  });
  it("rejects a non-positive qty", () => {
    const r = saveDraftInputSchema.safeParse({
      doc: { docType: "quote" },
      lines: [{ productId: null, title: "X", qty: 0, unitCents: 1000, vatRatePct: 15 }],
    });
    expect(r.success).toBe(false);
  });
});
