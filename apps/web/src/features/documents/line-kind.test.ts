import { describe, expect, it } from "vitest";
import { toRpcLines } from "./payload";

// Work on a car goes to the jobs board; goods over the counter do not. A catalogue line
// answers through its product; a hand-typed line has no product, so the builder asks and
// the answer rides down here. These pin both halves: what gets stored, and how the
// stored answer is read back into the job-or-sale decision.

const line = (over: Partial<Parameters<typeof toRpcLines>[0][number]> = {}) => ({
  productId: null,
  title: "line",
  description: null,
  qty: 1,
  unitCents: 10_000,
  discountPct: 0,
  discountKind: "percent" as const,
  discountAmountCents: 0,
  vatRatePct: 15,
  lineKind: null,
  ...over,
});

describe("toRpcLines — who states a line's kind", () => {
  it("sends what the builder was told about a hand-typed line", () => {
    expect(toRpcLines([line({ lineKind: "service" })])[0].line_kind).toBe("service");
    expect(toRpcLines([line({ lineKind: "product" })])[0].line_kind).toBe("product");
  });

  it("leaves a catalogue line to its product", () => {
    expect(toRpcLines([line({ productId: "p1", lineKind: "service" })])[0].line_kind).toBeNull();
  });

  it("sends null when nothing was stated", () => {
    expect(toRpcLines([line()])[0].line_kind).toBeNull();
  });
});

/** The rule getDocumentDetail applies — same coalesce the database documents. */
const hasService = (rows: { line_kind?: string | null; products?: { kind: string } | null }[]) =>
  rows.some((l) => (l.line_kind ?? l.products?.kind ?? "service") === "service");

describe("hasService — job or sale", () => {
  it("a catalogue service is work", () => {
    expect(hasService([{ products: { kind: "service" } }])).toBe(true);
  });

  it("catalogue goods alone are not", () => {
    expect(hasService([{ products: { kind: "product" } }, { products: { kind: "consumable" } }])).toBe(false);
  });

  it("a typed-in line is whatever the operator said", () => {
    expect(hasService([{ line_kind: "service" }])).toBe(true);
    expect(hasService([{ line_kind: "product" }])).toBe(false);
  });

  it("a stated kind beats the product behind it", () => {
    expect(hasService([{ line_kind: "product", products: { kind: "service" } }])).toBe(false);
  });

  it("one service anywhere is enough", () => {
    expect(hasService([{ products: { kind: "product" } }, { line_kind: "service" }])).toBe(true);
  });

  // History: ad-hoc lines written before the builders asked state nothing, and they were
  // overwhelmingly labour. Reading them as goods would put the shop's back catalogue on
  // the wrong side — and work with no job card is work nobody is tracking.
  it("an old line that states nothing is read as work", () => {
    expect(hasService([{}])).toBe(true);
  });

  it("an empty document has no work on it", () => {
    expect(hasService([])).toBe(false);
  });
});
