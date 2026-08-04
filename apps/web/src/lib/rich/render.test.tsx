import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RichContent } from "./render";
import type { RichDoc } from "./types";

const doc = (...blocks: RichDoc["blocks"]): RichDoc => ({ schemaVersion: 1, blocks });
const html = (d: RichDoc | null) => renderToStaticMarkup(<RichContent doc={d} />);

describe("RichContent", () => {
  it("renders a paragraph's text", () => {
    expect(html(doc({ type: "p", runs: [{ text: "Full Vehicle decontamination" }] }))).toContain(
      "Full Vehicle decontamination",
    );
  });

  it("renders bold, italic and strikethrough as their own elements", () => {
    const out = html(
      doc({ type: "p", runs: [{ text: "a", bold: true }, { text: "b", italic: true }, { text: "c", strike: true }] }),
    );
    expect(out).toContain("<strong>a</strong>");
    expect(out).toContain("<em>b</em>");
    expect(out).toContain("<s>c</s>");
  });

  it("renders a link with its href", () => {
    const out = html(doc({ type: "p", runs: [{ text: "warranty", href: "https://example.com/terms" }] }));
    expect(out).toContain('href="https://example.com/terms"');
    expect(out).toContain("warranty");
  });

  it("renders the four Diamondbrite bullets as list items", () => {
    const out = html(
      doc({
        type: "ul",
        items: [
          [{ text: "Full Vehicle decontamination" }],
          [{ text: "Paint Correction ( 1 - 5 Step polishing depending on surface damages)" }],
          [{ text: "Ceramic Coating 3 years protection on body only" }],
          [{ text: "Plastic treatment and restoration" }],
        ],
      }),
    );
    expect(out).toContain("<ul");
    expect(out.match(/<li/g)).toHaveLength(4);
    expect(out).toContain("Plastic treatment and restoration");
  });

  it("renders a numbered list as an ol", () => {
    const out = html(doc({ type: "ol", items: [[{ text: "Wash" }], [{ text: "Clay" }]] }));
    expect(out).toContain("<ol");
    expect(out.match(/<li/g)).toHaveLength(2);
  });

  it("renders a table as rows and cells", () => {
    const out = html(
      doc({
        type: "table",
        rows: [
          [[{ text: "Stage" }], [{ text: "Covered" }]],
          [[{ text: "Body panels" }], [{ text: "Yes" }]],
        ],
      }),
    );
    expect(out).toContain("<table");
    expect(out.match(/<tr/g)).toHaveLength(2);
    expect(out.match(/<td/g)).toHaveLength(4);
  });

  it("skips a block type it does not recognise instead of throwing", () => {
    const d = { schemaVersion: 1, blocks: [{ type: "hologram" }, { type: "p", runs: [{ text: "kept" }] }] };
    const out = html(d as unknown as RichDoc);
    expect(out).toContain("kept");
    expect(out).not.toContain("hologram");
  });

  it("renders script-shaped text as visible text, never as markup", () => {
    // The whole reason content is a typed tree and not an HTML string: DocumentA4
    // renders into a live authenticated staff browser, not only headless Chromium.
    const out = html(doc({ type: "p", runs: [{ text: "<script>alert(1)</script>" }] }));
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("refuses a javascript: link, keeping the text but dropping the href", () => {
    const out = html(doc({ type: "p", runs: [{ text: "tap me", href: "javascript:alert(1)" }] }));
    expect(out).not.toContain("javascript:");
    expect(out).toContain("tap me");
  });

  it("renders nothing at all when there is no content", () => {
    expect(html(null)).toBe("");
    expect(html(doc())).toBe("");
  });
});
