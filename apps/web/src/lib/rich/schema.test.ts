import { describe, it, expect } from "vitest";
import { parseRichDoc, richDocSchema, MAX_RICH_BYTES } from "./schema";

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

  it("drops a block type this build does not know, matching the tablet", () => {
    // Was: the whole document was refused. That disagreed with RichDoc.kt, which
    // drops the block and keeps going — see the leniency block below.
    expect(parseRichDoc({ schemaVersion: 1, blocks: [{ type: "hologram" }] })).toEqual({
      schemaVersion: 1,
      blocks: [],
    });
  });

  it("returns null for a schema version from the future", () => {
    expect(parseRichDoc({ schemaVersion: 2, blocks: [] })).toBeNull();
  });

  it("does not re-check size on the way in", () => {
    // The size limit belongs to the WRITE path (richDocSchema) and to the column's
    // own CHECK, which together make an oversized stored row impossible. Refusing
    // one here would only invent a disagreement with RichDoc.kt, which does not
    // check size either — and would hide a description rather than print it.
    const huge = { schemaVersion: 1, blocks: [{ type: "p", runs: [{ text: "z".repeat(21000) }] }] };
    expect(parseRichDoc(huge)?.blocks).toHaveLength(1);
  });

  it("never throws, whatever the row contains", () => {
    expect(() => parseRichDoc(42)).not.toThrow();
    expect(() => parseRichDoc([])).not.toThrow();
    expect(() => parseRichDoc({ blocks: null })).not.toThrow();
  });
});

describe("parseRichDoc — lenient like the tablet's walker", () => {
  it("keeps the good runs when one run in a paragraph is malformed", () => {
    // The tablet drops only the offending run (RichDoc.kt readRuns). The web used to
    // fail the whole document, so one bad run meant the printed quote showed NO
    // description while the tablet showed most of it — the same row, two documents.
    const doc = parseRichDoc({
      schemaVersion: 1,
      blocks: [{ type: "p", runs: [{ text: "Valid text" }, { bold: true }] }],
    });
    expect(doc).not.toBeNull();
    expect(doc!.blocks).toEqual([{ type: "p", runs: [{ text: "Valid text" }] }]);
  });

  it("keeps the good blocks when one block is malformed", () => {
    const doc = parseRichDoc({
      schemaVersion: 1,
      blocks: [{ type: "hologram" }, { type: "p", runs: [{ text: "kept" }] }],
    });
    expect(doc!.blocks).toEqual([{ type: "p", runs: [{ text: "kept" }] }]);
  });

  it("still refuses a schema version from the future outright", () => {
    // Leniency is per-node. A version we do not know means we cannot trust the
    // shape at all, and both platforms agree to show nothing.
    expect(parseRichDoc({ schemaVersion: 2, blocks: [] })).toBeNull();
  });

  it("still refuses anything that is not an object", () => {
    expect(parseRichDoc("a stringified blob")).toBeNull();
    expect(parseRichDoc(42)).toBeNull();
    expect(parseRichDoc([])).toBeNull();
  });
});

describe("the size guard measures what the database measures", () => {
  it("counts bytes, not UTF-16 code units", () => {
    // The CHECK is octet_length(...::text). A description of accented French — routine
    // in Mauritius — is heavier in bytes than in JS string length, so a document the
    // client accepted could still be rejected by Postgres.
    const accented = { schemaVersion: 1 as const, blocks: [{ type: "p" as const, runs: [{ text: "é".repeat(11000) }] }] };
    expect(JSON.stringify(accented).length).toBeLessThan(MAX_RICH_BYTES);
    expect(richDocSchema.safeParse(accented).success).toBe(false);
  });

  it("still accepts a normal description", () => {
    const ok = { schemaVersion: 1 as const, blocks: [{ type: "ul" as const, items: [[{ text: "Full Vehicle decontamination" }]] }] };
    expect(richDocSchema.safeParse(ok).success).toBe(true);
  });
});
