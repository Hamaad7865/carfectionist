import { describe, expect, it } from "vitest";
import { firstName, resolveVariable, renderVariables, renderBodyPreview, waFormatToHtml, countVariables } from "./render";

describe("variable resolution", () => {
  const c = { name: "Anesh Boodoo" };
  it("first_name = first word", () => expect(resolveVariable("first_name", c)).toBe("Anesh"));
  it("name = full name", () => expect(resolveVariable("name", c)).toBe("Anesh Boodoo"));
  it("static:… = literal", () => expect(resolveVariable("static:July promo", c)).toBe("July promo"));
  it("unknown → empty", () => expect(resolveVariable("mystery", c)).toBe(""));
  it("firstName handles single word and blanks", () => {
    expect(firstName("Diksha")).toBe("Diksha");
    expect(firstName("   ")).toBe("");
  });
});

describe("renderVariables", () => {
  it("renders positional values in order", () => {
    const vals = renderVariables({ "1": "first_name", "2": "static:20%" }, 2, { name: "Anesh Boodoo" });
    expect(vals).toEqual(["Anesh", "20%"]);
  });
  it("pads missing mappings with empty strings", () => {
    expect(renderVariables({ "1": "name" }, 3, { name: "Nikka" })).toEqual(["Nikka", "", ""]);
  });
});

describe("renderBodyPreview", () => {
  it("substitutes placeholders", () => {
    expect(renderBodyPreview("Hi {{1}}, {{2}} off!", ["Anesh", "20%"])).toBe("Hi Anesh, 20% off!");
  });
  it("keeps a placeholder when no value", () => {
    expect(renderBodyPreview("Hi {{1}} {{2}}", ["Anesh"])).toBe("Hi Anesh {{2}}");
  });
});

describe("waFormatToHtml", () => {
  it("renders bold/italic/strike and escapes html", () => {
    expect(waFormatToHtml("*bold* _italic_ ~gone~")).toBe("<b>bold</b> <i>italic</i> <s>gone</s>");
    expect(waFormatToHtml("<script>")).toBe("&lt;script&gt;");
    expect(waFormatToHtml("a\nb")).toBe("a<br/>b");
  });
});

describe("countVariables", () => {
  it("counts distinct placeholders", () => {
    expect(countVariables("Hi {{1}}, {{2}} — see you {{1}}")).toBe(2);
    expect(countVariables("no vars")).toBe(0);
  });
});
