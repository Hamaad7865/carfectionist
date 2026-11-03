import { describe, expect, it, vi } from "vitest";
import { fakeAdmin } from "@/lib/supabase/fake-admin";

// The public enquiry form has no session, so the service role decides which shop
// the enquiry is filed under. It must be the real shop, never the TEST Sandbox —
// an enquiry in the sandbox inbox is a lead nobody ever sees.

let admin: unknown;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { submitEnquiryAction } from "./actions";

const LIVE = "11111111-1111-4111-8111-000000000001";
const SANDBOX = "22222222-2222-4222-8222-000000000002";

// The sandbox row comes FIRST and is the OLDER one, so neither "first row" nor
// "oldest row" finds the shop — only excluding the sandbox does.
const sandbox = { id: SANDBOX, is_sandbox: true, created_at: "2026-07-01T00:00:00Z" };
const live = { id: LIVE, is_sandbox: false, created_at: "2026-07-04T06:20:11Z" };

const enquiry = { name: "Ravi", phone: "52588854", vehicleInfo: "Polo GTI", message: "Ceramic coating price?" };

describe("submitEnquiryAction — which shop receives a web enquiry", () => {
  it("files the enquiry under the live shop, not the sandbox listed first", async () => {
    const tables = { business_settings: [sandbox, live], enquiries: [] as Record<string, unknown>[] };
    admin = fakeAdmin(tables);

    const r = await submitEnquiryAction(enquiry);

    expect(r).toEqual({ ok: true });
    expect(tables.enquiries).toHaveLength(1);
    expect(tables.enquiries[0]).toMatchObject({ tenant_id: LIVE, name: "Ravi", source: "web", status: "new" });
  });

  it("refuses rather than fall back to the sandbox when there is no live shop", async () => {
    const tables = { business_settings: [sandbox], enquiries: [] as Record<string, unknown>[] };
    admin = fakeAdmin(tables);

    const r = await submitEnquiryAction(enquiry);

    expect(r).toEqual({ ok: false, error: "Unable to submit right now." });
    expect(tables.enquiries).toHaveLength(0);
  });
});
