import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildTemplatePayload, buildSendPayload, buildDocumentSendPayload, verifyWebhookSignature, isConfigured } from "./whatsapp";

describe("buildTemplatePayload", () => {
  it("builds a BODY component with variable examples", () => {
    const p = buildTemplatePayload({
      name: "july_promo",
      language: "en",
      category: "MARKETING",
      body: "Hi {{1}}, enjoy {{2}} off this month!",
      variableExamples: ["Anesh", "20%"],
    });
    expect(p.name).toBe("july_promo");
    expect(p.components[0]).toMatchObject({ type: "BODY", text: "Hi {{1}}, enjoy {{2}} off this month!" });
    expect((p.components[0] as { example: { body_text: string[][] } }).example.body_text).toEqual([["Anesh", "20%"]]);
  });
  it("omits the example block when there are no variables", () => {
    const p = buildTemplatePayload({ name: "hello", language: "en", category: "MARKETING", body: "Hello!", variableExamples: [] });
    expect(p.components[0]).not.toHaveProperty("example");
  });
});

describe("buildSendPayload", () => {
  it("maps positional variables to body parameters", () => {
    const p = buildSendPayload("23052588854", "july_promo", "en", ["Anesh", "20%"]);
    expect(p).toMatchObject({ messaging_product: "whatsapp", to: "23052588854", type: "template" });
    expect(p.template.name).toBe("july_promo");
    expect(p.template.language).toEqual({ code: "en" });
    expect((p.template as { components: unknown[] }).components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Anesh" }, { type: "text", text: "20%" }] },
    ]);
  });
  it("has no components for a variable-free template", () => {
    const p = buildSendPayload("23052588854", "hello", "en", []);
    expect(p.template).not.toHaveProperty("components");
  });
});

describe("verifyWebhookSignature", () => {
  const OLD = process.env.WHATSAPP_APP_SECRET;
  beforeEach(() => { process.env.WHATSAPP_APP_SECRET = "test-app-secret"; });
  afterEach(() => { if (OLD === undefined) delete process.env.WHATSAPP_APP_SECRET; else process.env.WHATSAPP_APP_SECRET = OLD; });

  it("accepts a correctly signed body and rejects tampering", async () => {
    const body = JSON.stringify({ hello: "world" });
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-app-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await verifyWebhookSignature(body, `sha256=${hex}`)).toBe(true);
    expect(await verifyWebhookSignature(body + " ", `sha256=${hex}`)).toBe(false);
    expect(await verifyWebhookSignature(body, null)).toBe(false);
  });
});

describe("isConfigured", () => {
  it("is false without credentials", () => {
    const keys = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_WABA_ID"] as const;
    const saved = keys.map((k) => process.env[k]);
    keys.forEach((k) => delete process.env[k]);
    expect(isConfigured()).toBe(false);
    keys.forEach((k, i) => { if (saved[i] !== undefined) process.env[k] = saved[i]; });
  });
});

describe("document-header templates", () => {
  it("buildTemplatePayload includes a DOCUMENT header when asked", () => {
    const p = buildTemplatePayload({
      name: "document_delivery", language: "en", category: "UTILITY",
      body: "Hello {{1}}, here is your {{2}} {{3}}.", variableExamples: ["Anesh", "quotation", "A00120"],
      headerFormat: "DOCUMENT",
    });
    expect(p.components[0]).toEqual({ type: "HEADER", format: "DOCUMENT" });
    expect(p.components[1]).toMatchObject({ type: "BODY" });
  });

  it("buildDocumentSendPayload carries the PDF link + filename in the header", () => {
    const p = buildDocumentSendPayload("23052588854", "document_delivery", "en", ["Anesh", "quotation", "A00120"], {
      link: "https://app-carfectionist.com/api/public/doc/tok/pdf",
      filename: "A00120.pdf",
    });
    const comps = (p.template as { components: Record<string, unknown>[] }).components;
    expect(comps[0]).toEqual({
      type: "header",
      parameters: [{ type: "document", document: { link: "https://app-carfectionist.com/api/public/doc/tok/pdf", filename: "A00120.pdf" } }],
    });
    expect(comps[1]).toMatchObject({ type: "body" });
  });

  it("buildTemplatePayload attaches the header example handle and the View URL button", () => {
    const p = buildTemplatePayload({
      name: "document_quote", language: "en", category: "UTILITY",
      body: "Hello {{1}}, your document is attached.", variableExamples: ["Anesh"],
      headerFormat: "DOCUMENT", headerHandle: "4::abc",
      urlButton: { text: "View", urlBase: "https://app-carfectionist.com/d/", exampleSuffix: "tok.sig" },
    });
    expect(p.components[0]).toEqual({ type: "HEADER", format: "DOCUMENT", example: { header_handle: ["4::abc"] } });
    expect(p.components[2]).toEqual({
      type: "BUTTONS",
      buttons: [{
        type: "URL", text: "View",
        url: "https://app-carfectionist.com/d/{{1}}",
        example: ["https://app-carfectionist.com/d/tok.sig"],
      }],
    });
  });

  it("buildDocumentSendPayload prefers a pre-uploaded media id over a link", () => {
    const p = buildDocumentSendPayload("23052588854", "document_quote", "en", ["A"], {
      id: "media-123",
      link: "https://x/pdf",
      filename: "a.pdf",
    });
    const comps = (p.template as { components: Record<string, unknown>[] }).components;
    expect(comps[0]).toEqual({
      type: "header",
      parameters: [{ type: "document", document: { id: "media-123", filename: "a.pdf" } }],
    });
  });

  it("buildDocumentSendPayload fills the View button's URL suffix when given", () => {
    const p = buildDocumentSendPayload("23052588854", "document_quote", "en", ["A"], {
      link: "https://x/pdf", filename: "a.pdf",
    }, "tok.sig");
    const comps = (p.template as { components: Record<string, unknown>[] }).components;
    expect(comps[2]).toEqual({
      type: "button", sub_type: "url", index: "0",
      parameters: [{ type: "text", text: "tok.sig" }],
    });
  });
});
