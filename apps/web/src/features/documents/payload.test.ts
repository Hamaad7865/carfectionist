import { describe, it, expect } from "vitest";
import { toRpcLines, toRpcDoc, saveDraftInputSchema } from "./payload";

/** The owner's real quote line — the content this whole feature exists to carry. */
const rich = {
  schemaVersion: 1 as const,
  blocks: [
    {
      type: "ul" as const,
      items: [
        [{ text: "Full Vehicle decontamination" }],
        [{ text: "Paint Correction ( 1 - 5 Step polishing depending on surface damages)" }],
        [{ text: "Ceramic Coating 3 years protection on body only" }],
        [{ text: "Plastic treatment and restoration" }],
      ],
    },
  ],
};

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

describe("toRpcLines (rich content)", () => {
  it("sends the tree through untouched", () => {
    const out = toRpcLines([
      { productId: null, title: "Diamondbrite 3 YEARS", qty: 1, unitCents: 2646502, vatRatePct: 15, rich },
    ]);
    expect(out[0].description_richtext).toEqual(rich);
  });

  it("derives the flat description from the tree rather than trusting a second copy", () => {
    // The mirror can never drift, because there is only ever one place to type it.
    const out = toRpcLines([
      { productId: null, title: "X", qty: 1, unitCents: 100, vatRatePct: 15, rich, description: "stale" },
    ]);
    expect(out[0].description).toBe(
      "- Full Vehicle decontamination\n" +
        "- Paint Correction ( 1 - 5 Step polishing depending on surface damages)\n" +
        "- Ceramic Coating 3 years protection on body only\n" +
        "- Plastic treatment and restoration",
    );
  });

  it("keeps a legacy plain description when a line has no tree", () => {
    const out = toRpcLines([
      { productId: null, title: "X", qty: 1, unitCents: 100, vatRatePct: 15, description: "typed before rich content existed" },
    ]);
    expect(out[0].description).toBe("typed before rich content existed");
    expect(out[0].description_richtext).toBeNull();
  });

  it("sends null, not an empty tree, for a description that was cleared", () => {
    const out = toRpcLines([
      { productId: null, title: "X", qty: 1, unitCents: 100, vatRatePct: 15, rich: { schemaVersion: 1 as const, blocks: [] } },
    ]);
    expect(out[0].description).toBeNull();
    expect(out[0].description_richtext).toBeNull();
  });

  it("carries the unit label, and null when there is none", () => {
    const out = toRpcLines([
      { productId: null, title: "Waterspot", qty: 3, unitCents: 100000, vatRatePct: 15, unitLabel: "panels" },
      { productId: null, title: "Wash", qty: 1, unitCents: 30000, vatRatePct: 15 },
    ]);
    expect(out[0].unit_label).toBe("panels");
    expect(out[1].unit_label).toBeNull();
  });
});

describe("saveDraftInputSchema (rich content)", () => {
  it("rejects a unit label longer than the column allows", () => {
    const r = saveDraftInputSchema.safeParse({
      doc: { docType: "quote" },
      lines: [{ productId: null, title: "X", qty: 1, unitCents: 1000, vatRatePct: 15, unitLabel: "y".repeat(25) }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a rich document bigger than the column allows", () => {
    const r = saveDraftInputSchema.safeParse({
      doc: { docType: "quote" },
      lines: [
        {
          productId: null, title: "X", qty: 1, unitCents: 1000, vatRatePct: 15,
          rich: { schemaVersion: 1, blocks: [{ type: "p", runs: [{ text: "z".repeat(21000) }] }] },
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("accepts a line carrying the real Diamondbrite bullets", () => {
    const r = saveDraftInputSchema.safeParse({
      doc: { docType: "quote" },
      lines: [{ productId: null, title: "X", qty: 1, unitCents: 1000, vatRatePct: 15, rich, unitLabel: "panels" }],
    });
    expect(r.success).toBe(true);
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
