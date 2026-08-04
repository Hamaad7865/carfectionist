import { describe, it, expect } from "vitest";
import { parseRichDoc } from "./schema";

const valid = {
  schemaVersion: 1,
  blocks: [{ type: "ul", items: [[{ text: "Full Vehicle decontamination" }]] }],
};

describe("parseRichDoc", () => {
  it("returns the tree when the row holds a real one", () => {
    expect(parseRichDoc(valid)).toEqual(valid);
  });

  it("returns null when the column is empty", () => {
    expect(parseRichDoc(null)).toBeNull();
    expect(parseRichDoc(undefined)).toBeNull();
  });

  it("returns null for a stringified blob rather than an object", () => {
    // What ->> instead of -> would have left in the column. It must not reach a
    // renderer as if it were a tree.
    expect(parseRichDoc(JSON.stringify(valid))).toBeNull();
  });

  it("returns null for a block type this build does not know", () => {
    expect(parseRichDoc({ schemaVersion: 1, blocks: [{ type: "hologram" }] })).toBeNull();
  });

  it("returns null for a schema version from the future", () => {
    expect(parseRichDoc({ schemaVersion: 2, blocks: [] })).toBeNull();
  });

  it("returns null for a tree too big for the column", () => {
    const huge = { schemaVersion: 1, blocks: [{ type: "p", runs: [{ text: "z".repeat(21000) }] }] };
    expect(parseRichDoc(huge)).toBeNull();
  });

  it("never throws, whatever the row contains", () => {
    expect(() => parseRichDoc(42)).not.toThrow();
    expect(() => parseRichDoc([])).not.toThrow();
    expect(() => parseRichDoc({ blocks: null })).not.toThrow();
  });
});
