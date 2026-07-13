import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildTemplatePayload, buildSendPayload, verifyWebhookSignature, isConfigured } from "./whatsapp";

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
