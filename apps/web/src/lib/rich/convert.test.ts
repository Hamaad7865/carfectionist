import { describe, it, expect } from "vitest";
import { fromTipTap, toTipTap } from "./convert";
import type { RichDoc } from "./types";

/**
 * TipTap nests doc → paragraph → text with a marks array. Our tree is flatter,
 * because the Kotlin and plain-text walkers have to read it too. These are the
 * two functions that sit between them.
 */

describe("fromTipTap", () => {
  it("reads a paragraph", () => {
    const out = fromTipTap({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Full Vehicle decontamination" }] }],
    });
    expect(out.blocks).toEqual([{ type: "p", runs: [{ text: "Full Vehicle decontamination" }] }]);
  });

  it("reads bold, italic and strike marks", () => {
    const out = fromTipTap({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [{ type: "bold" }] },
            { type: "text", text: "b", marks: [{ type: "italic" }] },
            { type: "text", text: "c", marks: [{ type: "strike" }] },
          ],
        },
      ],
    });
    expect(out.blocks[0]).toEqual({
      type: "p",
      runs: [{ text: "a", bold: true }, { text: "b", italic: true }, { text: "c", strike: true }],
    });
  });

  it("reads a link's href off the mark", () => {
    const out = fromTipTap({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "terms", marks: [{ type: "link", attrs: { href: "https://x/t" } }] }] },
      ],
    });
    expect(out.blocks[0]).toEqual({ type: "p", runs: [{ text: "terms", href: "https://x/t" }] });
  });

  it("flattens a bullet list's listItem → paragraph nesting", () => {
    const out = fromTipTap({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Full Vehicle decontamination" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Plastic treatment and restoration" }] }] },
          ],
        },
      ],
    });
    expect(out.blocks[0]).toEqual({
      type: "ul",
      items: [[{ text: "Full Vehicle decontamination" }], [{ text: "Plastic treatment and restoration" }]],
    });
  });

  it("reads an ordered list", () => {
    const out = fromTipTap({
      type: "doc",
      content: [
        { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Wash" }] }] }] },
      ],
    });
    expect(out.blocks[0]).toEqual({ type: "ol", items: [[{ text: "Wash" }]] });
  });

  it("reads a table, treating a header cell as an ordinary cell", () => {
    const cell = (text: string, header = false) => ({
      type: header ? "tableHeader" : "tableCell",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const out = fromTipTap({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("Stage", true), cell("Covered", true)] },
            { type: "tableRow", content: [cell("Body panels"), cell("Yes")] },
          ],
        },
      ],
    });
    expect(out.blocks[0]).toEqual({
      type: "table",
      rows: [
        [[{ text: "Stage" }], [{ text: "Covered" }]],
        [[{ text: "Body panels" }], [{ text: "Yes" }]],
      ],
    });
  });

  it("skips a node type we deliberately did not enable", () => {
    const out = fromTipTap({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "nope" }] },
        { type: "paragraph", content: [{ type: "text", text: "kept" }] },
      ],
    });
    expect(out.blocks).toEqual([{ type: "p", runs: [{ text: "kept" }] }]);
  });

  it("drops a paragraph that holds no text, so an untouched editor stores nothing", () => {
    const out = fromTipTap({ type: "doc", content: [{ type: "paragraph" }] });
    expect(out.blocks).toEqual([]);
  });

  it("never throws on a shape it does not expect", () => {
    expect(() => fromTipTap(null)).not.toThrow();
    expect(() => fromTipTap({ type: "doc" })).not.toThrow();
    expect(fromTipTap(null).blocks).toEqual([]);
  });
});

describe("toTipTap", () => {
  const diamondbrite: RichDoc = {
    schemaVersion: 1,
    blocks: [
      {
        type: "ul",
        items: [
          [{ text: "Full Vehicle decontamination" }],
          [{ text: "Paint Correction ( 1 - 5 Step polishing depending on surface damages)" }],
          [{ text: "Ceramic Coating 3 years protection on body only" }],
          [{ text: "Plastic treatment and restoration" }],
        ],
      },
    ],
  };

  it("gives TipTap a doc it can load", () => {
    const out = toTipTap(diamondbrite);
    expect(out.type).toBe("doc");
    expect(out.content?.[0].type).toBe("bulletList");
    expect(out.content?.[0].content).toHaveLength(4);
  });

  it("gives an empty document one empty paragraph, which TipTap requires", () => {
    expect(toTipTap(null)).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(toTipTap({ schemaVersion: 1, blocks: [] })).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("round-trips the owner's real line unchanged", () => {
    expect(fromTipTap(toTipTap(diamondbrite))).toEqual(diamondbrite);
  });

  it("round-trips every mark and a table unchanged", () => {
    const doc: RichDoc = {
      schemaVersion: 1,
      blocks: [
        { type: "p", runs: [{ text: "a", bold: true }, { text: "b", italic: true }, { text: "c", strike: true }, { text: "d", href: "https://x/t" }] },
        { type: "ol", items: [[{ text: "one" }]] },
        { type: "table", rows: [[[{ text: "Stage" }], [{ text: "Covered" }]]] },
      ],
    };
    expect(fromTipTap(toTipTap(doc))).toEqual(doc);
  });
});

describe("fromTipTap — nothing typed is silently lost", () => {
  const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

  it("separates two paragraphs in one table cell instead of gluing them", () => {
    const out = fromTipTap({
      type: "doc",
      content: [
        {
          type: "table",
          content: [{ type: "tableRow", content: [{ type: "tableCell", content: [para("Body panels"), para("and glass")] }] }],
        },
      ],
    });
    // Was "Body panelsand glass".
    const cell = (out.blocks[0] as { rows: { text: string }[][][] }).rows[0][0];
    expect(cell.map((r) => r.text).join("")).toBe("Body panels and glass");
  });

  it("keeps a list nested inside a list item rather than dropping it", () => {
    // TipTap's listItem allows a nested list (Tab indents). Our tree is flat by
    // design, so the words are folded into the parent item — flattened, not lost.
    const out = fromTipTap({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [para("Paint Correction"), { type: "bulletList", content: [{ type: "listItem", content: [para("1 to 5 step")] }] }],
            },
          ],
        },
      ],
    });
    const items = (out.blocks[0] as { items: { text: string }[][] }).items;
    expect(items).toHaveLength(1);
    expect(items[0].map((r) => r.text).join("")).toBe("Paint Correction 1 to 5 step");
  });

  it("still reads an ordinary single-paragraph item unchanged", () => {
    const out = fromTipTap({
      type: "doc",
      content: [{ type: "bulletList", content: [{ type: "listItem", content: [para("Full Vehicle decontamination")] }] }],
    });
    expect(out.blocks[0]).toEqual({ type: "ul", items: [[{ text: "Full Vehicle decontamination" }]] });
  });
});
