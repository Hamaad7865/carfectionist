import { describe, it, expect } from "vitest";
import { richToPlainText } from "./plain";
import type { RichDoc } from "./types";

const doc = (...blocks: RichDoc["blocks"]): RichDoc => ({ schemaVersion: 1, blocks });

describe("richToPlainText", () => {
  it("returns the text of a paragraph", () => {
    expect(richToPlainText(doc({ type: "p", runs: [{ text: "Full Vehicle decontamination" }] }))).toBe(
      "Full Vehicle decontamination",
    );
  });

  it("joins runs without separators and drops their marks", () => {
    const d = doc({ type: "p", runs: [{ text: "Paint ", bold: true }, { text: "Correction", italic: true }] });
    expect(richToPlainText(d)).toBe("Paint Correction");
  });

  it("keeps a link's visible text and never its href", () => {
    const d = doc({ type: "p", runs: [{ text: "warranty terms", href: "https://example.com/terms" }] });
    expect(richToPlainText(d)).toBe("warranty terms");
  });

  it("prefixes bulleted items with a dash", () => {
    const d = doc({
      type: "ul",
      items: [
        [{ text: "Full Vehicle decontamination" }],
        [{ text: "Paint Correction ( 1 - 5 Step polishing depending on surface damages)" }],
        [{ text: "Ceramic Coating 3 years protection on body only" }],
        [{ text: "Plastic treatment and restoration" }],
      ],
    });
    expect(richToPlainText(d)).toBe(
      "- Full Vehicle decontamination\n" +
        "- Paint Correction ( 1 - 5 Step polishing depending on surface damages)\n" +
        "- Ceramic Coating 3 years protection on body only\n" +
        "- Plastic treatment and restoration",
    );
  });

  it("numbers ordered items from one", () => {
    const d = doc({ type: "ol", items: [[{ text: "Wash" }], [{ text: "Clay" }], [{ text: "Polish" }]] });
    expect(richToPlainText(d)).toBe("1. Wash\n2. Clay\n3. Polish");
  });

  it("joins table cells with a pipe and rows with a newline", () => {
    const d = doc({
      type: "table",
      rows: [
        [[{ text: "Stage" }], [{ text: "Covered" }]],
        [[{ text: "Body panels" }], [{ text: "Yes" }]],
      ],
    });
    expect(richToPlainText(d)).toBe("Stage | Covered\nBody panels | Yes");
  });

  it("separates blocks with a newline", () => {
    const d = doc(
      { type: "p", runs: [{ text: "Includes:" }] },
      { type: "ul", items: [[{ text: "Decontamination" }]] },
    );
    expect(richToPlainText(d)).toBe("Includes:\n- Decontamination");
  });

  it("skips a block type it does not recognise instead of throwing", () => {
    // Fails closed: an older row, or a newer schema from the other platform, must
    // never take down the render. See schemaVersion in the spec.
    const d = { schemaVersion: 1, blocks: [{ type: "hologram" }, { type: "p", runs: [{ text: "kept" }] }] };
    expect(richToPlainText(d as unknown as RichDoc)).toBe("kept");
  });

  it("is empty for a document with no blocks", () => {
    expect(richToPlainText(doc())).toBe("");
  });

  it("is empty for null, so an unset description flattens to nothing", () => {
    expect(richToPlainText(null)).toBe("");
  });
});
