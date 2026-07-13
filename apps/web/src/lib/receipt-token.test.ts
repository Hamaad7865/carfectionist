import { describe, expect, it } from "vitest";
import { receiptToken, verifyReceiptToken } from "./receipt-token";

const DOC = "1f7c9a52-3b1e-4c8d-9a2f-6e5b4d3c2b1a";

describe("receipt tokens", () => {
  it("round-trips a signed token", async () => {
    const t = await receiptToken(DOC);
    expect(await verifyReceiptToken(t)).toBe(DOC);
  });
  it("rejects a tampered signature", async () => {
    const t = await receiptToken(DOC);
    const [id] = t.split(".");
    expect(await verifyReceiptToken(`${id}.AAAAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
  });
  it("rejects a swapped document id", async () => {
    const t = await receiptToken(DOC);
    const [, sig] = t.split(".");
    const otherId = Buffer.from("9f7c9a52-3b1e-4c8d-9a2f-6e5b4d3c2b1a").toString("base64").replace(/=+$/, "");
    expect(await verifyReceiptToken(`${otherId}.${sig}`)).toBeNull();
  });
  it("rejects junk", async () => {
    expect(await verifyReceiptToken("not-a-token")).toBeNull();
    expect(await verifyReceiptToken("a.b")).toBeNull();
  });
});

describe("doc tokens are a separate kind", () => {
  it("round-trips and never cross-validates with receipt tokens", async () => {
    const { docToken, verifyDocToken, receiptToken, verifyReceiptToken } = await import("./receipt-token");
    const id = "1f7c9a52-3b1e-4c8d-9a2f-6e5b4d3c2b1a";
    const dt = await docToken(id);
    expect(await verifyDocToken(dt)).toBe(id);
    expect(await verifyReceiptToken(dt)).toBeNull(); // doc token can't open a ticket
    expect(await verifyDocToken(await receiptToken(id))).toBeNull(); // and vice-versa
  });
});
