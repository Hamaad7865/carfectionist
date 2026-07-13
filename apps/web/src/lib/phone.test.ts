import { describe, expect, it } from "vitest";
import { normalizePhoneMU, formatPhone } from "./phone";

describe("normalizePhoneMU", () => {
  it("prefixes a local 8-digit mobile", () => {
    expect(normalizePhoneMU("52588854")).toBe("23052588854");
    expect(normalizePhoneMU("5258 8854")).toBe("23052588854");
  });
  it("prefixes a local 7-digit landline", () => {
    expect(normalizePhoneMU("4661234")).toBe("2304661234");
  });
  it("keeps a +230 number", () => {
    expect(normalizePhoneMU("+230 5258 8854")).toBe("23052588854");
  });
  it("strips a 00230 international prefix", () => {
    expect(normalizePhoneMU("00230 5258 8854")).toBe("23052588854");
  });
  it("accepts a country code typed without +", () => {
    expect(normalizePhoneMU("23052588854")).toBe("23052588854");
  });
  it("passes a foreign +33 number through", () => {
    expect(normalizePhoneMU("+33 6 12 34 56 78")).toBe("33612345678");
  });
  it("handles punctuation and parentheses", () => {
    expect(normalizePhoneMU("(+230) 5258-8854")).toBe("23052588854");
  });
  it("rejects junk and empties", () => {
    expect(normalizePhoneMU("")).toBeNull();
    expect(normalizePhoneMU("   ")).toBeNull();
    expect(normalizePhoneMU("abc")).toBeNull();
    expect(normalizePhoneMU(null)).toBeNull();
    expect(normalizePhoneMU(undefined)).toBeNull();
  });
  it("rejects too-short and too-long numbers", () => {
    expect(normalizePhoneMU("12345")).toBeNull(); // 5 digits, not 7/8, stays short
    expect(normalizePhoneMU("+1234567890123456")).toBeNull(); // 16 digits
  });
});

describe("formatPhone", () => {
  it("pretty-prints an MU mobile", () => {
    expect(formatPhone("23052588854")).toBe("+230 5258 8854");
  });
  it("prints a foreign number with just a plus", () => {
    expect(formatPhone("33612345678")).toBe("+33612345678");
  });
});
