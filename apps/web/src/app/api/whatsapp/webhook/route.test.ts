import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeAdmin } from "@/lib/supabase/fake-admin";

// A Meta callback has no session, so the service role decides which shop a
// customer's reply belongs to. It must be the real shop: between August and
// October "the first settings row" flipped to the TEST Sandbox on and off and
// filed 15 real replies where nobody looks — and dropped the live shop's
// delivery ticks on the same days.

let admin: unknown;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

const ingestInbound = vi.fn();
vi.mock("@/lib/wa-inbox", () => ({ ingestInbound: (...a: unknown[]) => ingestInbound(...a) }));
vi.mock("@/lib/whatsapp", () => ({
  verifyWebhookSignature: async () => true,
  webhookVerifyToken: () => "verify-token",
  explainWaFailure: () => "failed",
}));

import { POST } from "./route";

const LIVE = "11111111-1111-4111-8111-000000000001";
const SANDBOX = "22222222-2222-4222-8222-000000000002";

// The sandbox row comes FIRST and is the OLDER one, so neither "first row" nor
// "oldest row" finds the shop — only excluding the sandbox does.
const sandbox = { id: SANDBOX, is_sandbox: true, created_at: "2026-07-01T00:00:00Z" };
const live = { id: LIVE, is_sandbox: false, created_at: "2026-07-04T06:20:11Z" };

const callback = (value: Record<string, unknown>) =>
  new Request("https://x.test/api/whatsapp/webhook", {
    method: "POST",
    headers: { "x-hub-signature-256": "sha256=ok" },
    body: JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PNID" }, ...value } }] }] }),
  });

const reply = { from: "23052588854", id: "wamid.IN", type: "text", text: { body: "Is my car ready?" } };

describe("WhatsApp webhook — which shop receives a customer's reply", () => {
  beforeEach(() => ingestInbound.mockClear());

  it("files an inbound reply under the live shop, not the sandbox listed first", async () => {
    admin = fakeAdmin({ business_settings: [sandbox, live] });

    const res = await POST(callback({ contacts: [{ wa_id: "23052588854", profile: { name: "Ravi" } }], messages: [reply] }));

    expect(res.status).toBe(200);
    expect(ingestInbound).toHaveBeenCalledTimes(1);
    expect(ingestInbound).toHaveBeenCalledWith(admin, LIVE, reply, "Ravi");
  });

  it("ticks the live shop's sent message as delivered", async () => {
    const out = { id: "m1", tenant_id: LIVE, direction: "out", wa_message_id: "wamid.OUT", status: "sent" };
    admin = fakeAdmin({ business_settings: [sandbox, live], campaign_recipients: [], wa_messages: [out] });

    await POST(callback({ statuses: [{ id: "wamid.OUT", status: "delivered" }] }));

    expect(out.status).toBe("delivered");
  });

  it("drops the reply rather than fall back to the sandbox when there is no live shop", async () => {
    admin = fakeAdmin({ business_settings: [sandbox] });

    const res = await POST(callback({ messages: [reply] }));

    expect(res.status).toBe(200);
    expect(ingestInbound).not.toHaveBeenCalled();
  });
});
