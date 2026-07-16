import { describe, it, expect } from "vitest";
import { colRef, buildXlsx, zipStore } from "./xlsx";

const dec = new TextDecoder();
const enc = new TextEncoder();
const asText = (b: Uint8Array) => dec.decode(b);

describe("colRef", () => {
  it("maps indexes to Excel column letters, including past Z", () => {
    expect(colRef(0)).toBe("A");
    expect(colRef(25)).toBe("Z");
    expect(colRef(26)).toBe("AA");
    expect(colRef(27)).toBe("AB");
    expect(colRef(51)).toBe("AZ");
    expect(colRef(52)).toBe("BA");
    expect(colRef(701)).toBe("ZZ");
    expect(colRef(702)).toBe("AAA");
  });
});

describe("zipStore", () => {
  it("writes a ZIP with the right magic and both directory records", () => {
    const z = zipStore([{ name: "a.txt", data: enc.encode("hello") }]);
    expect([z[0], z[1], z[2], z[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
    const s = asText(z);
    expect(s).toContain("a.txt");
    expect(s).toContain("hello");
    // central directory + end-of-central-directory signatures present
    expect(z.includes(0x02)).toBe(true);
    expect(asText(z.slice(-22, -18))).toBe("PK");
  });
});

describe("buildXlsx", () => {
  const bytes = buildXlsx("Daily summary", [
    ["Daily summary", null, "Payments"],
    ["Date", "Tickets", "cash / Total"],
    ["2026-07-13", 6, 36292.5],
  ]);
  const text = asText(bytes);

  it("is a zip containing every part Excel requires", () => {
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    for (const part of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"]) {
      expect(text).toContain(part);
    }
  });

  it("writes numbers as numbers and text as inline strings", () => {
    expect(text).toContain("<v>36292.5</v>"); // a real number, not a string
    expect(text).toContain("<v>6</v>");
    expect(text).toContain(">Date<");
    expect(text).toContain('t="inlineStr"');
  });

  it("addresses cells correctly and skips blanks", () => {
    expect(text).toContain('r="A1"'); // "Daily summary"
    expect(text).toContain('r="C1"'); // "Payments" — B1 is blank and omitted
    expect(text).not.toContain('r="B1"');
    expect(text).toContain('r="C3"'); // the number row
  });

  it("names the sheet", () => {
    expect(text).toContain('name="Daily summary"');
  });

  it("neutralises spreadsheet formula injection", () => {
    const t = asText(buildXlsx("s", [["=cmd|'/c calc'!A1", "-2+3", "@SUM(1)", "+1"]]));
    expect(t).toContain("&apos;=cmd".replace("&apos;", "'")); // leading apostrophe added
    expect(t).toContain("'-2+3");
    expect(t).toContain("'@SUM(1)");
    expect(t).toContain("'+1");
  });

  it("escapes XML so a customer name can't break the sheet", () => {
    const t = asText(buildXlsx("s", [['Bob & "Sons" <Ltd>']]));
    expect(t).toContain("Bob &amp; &quot;Sons&quot; &lt;Ltd&gt;");
  });
});
