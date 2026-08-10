import { describe, it, expect } from "vitest";
import { reducer, blankLine, toSaveDraftLines, type BuilderState, type BuilderLine } from "./state";

const line = (key: string, title: string): BuilderLine => ({ ...blankLine(), key, title });

const base: BuilderState = {
  docId: "d1",
  docType: "quote",
  status: "draft",
  number: null,
  issueDate: null,
  customerId: null,
  revision: 3,
  lines: [line("a", "Decontamination"), line("b", "Waterspot"), line("c", "Diamondbrite")],
  docDiscountKind: null,
  docDiscountValue: 0,
  docDiscountReason: "",
  sectionConfig: {},
  customFields: [],
  comment: "",
  dirty: false,
  save: "saved",
  saveError: null,
};

const titles = (s: BuilderState) => s.lines.map((l) => l.title);

describe("moveLine", () => {
  it("moves a line up", () => {
    const s = reducer(base, { type: "moveLine", key: "c", by: -1 });
    expect(titles(s)).toEqual(["Decontamination", "Diamondbrite", "Waterspot"]);
  });

  it("moves a line down", () => {
    const s = reducer(base, { type: "moveLine", key: "a", by: 1 });
    expect(titles(s)).toEqual(["Waterspot", "Decontamination", "Diamondbrite"]);
  });

  it("does nothing at the top", () => {
    const s = reducer(base, { type: "moveLine", key: "a", by: -1 });
    expect(titles(s)).toEqual(titles(base));
  });

  it("does nothing at the bottom", () => {
    const s = reducer(base, { type: "moveLine", key: "c", by: 1 });
    expect(titles(s)).toEqual(titles(base));
  });

  it("marks the document dirty so the new order is saved", () => {
    // sort_order is written from the array index, so reordering IS the persistence.
    expect(reducer(base, { type: "moveLine", key: "a", by: 1 }).dirty).toBe(true);
  });

  it("leaves the document alone when the key is unknown", () => {
    const s = reducer(base, { type: "moveLine", key: "zzz", by: 1 });
    expect(titles(s)).toEqual(titles(base));
  });
});

describe("duplicateLine", () => {
  const rich = { schemaVersion: 1 as const, blocks: [{ type: "ul" as const, items: [[{ text: "Ceramic Coating" }]] }] };

  it("puts the copy directly after the original", () => {
    const s = reducer(base, { type: "duplicateLine", key: "a" });
    expect(titles(s)).toEqual(["Decontamination", "Decontamination", "Waterspot", "Diamondbrite"]);
  });

  it("gives the copy its own key, so editing one does not edit both", () => {
    const s = reducer(base, { type: "duplicateLine", key: "a" });
    expect(s.lines[1].key).not.toBe(s.lines[0].key);
  });

  it("carries the description and the unit onto the copy", () => {
    // The point of duplicating the Diamondbrite line is not to retype its bullets.
    const withRich: BuilderState = {
      ...base,
      lines: [{ ...line("a", "Diamondbrite"), rich, unitLabel: "panels" }],
    };
    const s = reducer(withRich, { type: "duplicateLine", key: "a" });
    expect(s.lines[1].rich).toEqual(rich);
    expect(s.lines[1].unitLabel).toBe("panels");
  });

  it("marks the document dirty", () => {
    expect(reducer(base, { type: "duplicateLine", key: "a" }).dirty).toBe(true);
  });
});

describe("setDiscountReason", () => {
  it("sets the reason", () => {
    const s = reducer(base, { type: "setDiscountReason", reason: "regular customer" });
    expect(s.docDiscountReason).toBe("regular customer");
  });

  it("marks the document dirty so a reason typed on its own still autosaves", () => {
    expect(reducer(base, { type: "setDiscountReason", reason: "repeat wash" }).dirty).toBe(true);
  });
});

describe("blankLine", () => {
  it("gives a freshly typed line the policy its default kind allows", () => {
    // A hand-typed line has no product, so its own lineKind decides (policyOf(null,
    // lineKind)). blankLine() defaults lineKind to "service", which is why a brand
    // new ad-hoc line starts undiscountable until the row's own Service/Product
    // control says otherwise.
    expect(blankLine().lineKind).toBe("service");
    expect(blankLine().discountPolicy).toBe("none");
  });
});

describe("toSaveDraftLines", () => {
  it("carries the description and the unit into the save payload", () => {
    // The builder used to hand-list the payload fields and simply forgot these two,
    // so everything typed into the editor was dropped on the way to the server while
    // every unit test still passed.
    const rich = { schemaVersion: 1 as const, blocks: [{ type: "ul" as const, items: [[{ text: "Ceramic Coating" }]] }] };
    const out = toSaveDraftLines([{ ...blankLine(), title: "Diamondbrite", rich, unitLabel: "panels" }]);
    expect(out[0].rich).toEqual(rich);
    expect(out[0].unitLabel).toBe("panels");
  });

  it("carries every editable field a line has", () => {
    // The generic guard: add a field to BuilderLine and forget the payload, and this
    // fails. `key` and `discountPolicy` are the only client-side-only fields —
    // discountPolicy is re-derived by the database itself from the product join
    // (app.document_discount_limits), so it is never document content.
    const line = blankLine();
    const out = toSaveDraftLines([line]);
    const carried = new Set(Object.keys(out[0]));
    const missing = Object.keys(line).filter((k) => k !== "key" && k !== "discountPolicy" && !carried.has(k));
    expect(missing).toEqual([]);
  });
});
