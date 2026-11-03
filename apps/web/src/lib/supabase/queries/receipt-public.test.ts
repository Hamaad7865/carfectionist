import { describe, expect, it, vi } from "vitest";

// The public /t/[token] receipt reads on the service role, where business_settings is no
// longer one row. The slip must name the shop that owns the bill — not the sandbox
// because its row happened to come back first.

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

/** A service-role client over fixture tables: filters really filter, and maybeSingle
 *  refuses two rows as PostgREST does. */
const serviceRole = {
  from: (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => ((rows = rows.filter((r) => r[col] === val)), q),
      order: () => q,
      limit: (n: number) => ((rows = rows.slice(0, n)), q),
      maybeSingle: async () =>
        rows.length > 1 ? { data: null, error: { message: "multiple rows" } } : { data: rows[0] ?? null, error: null },
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok, ko),
    };
    return q;
  },
};

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => serviceRole }));

import { getReceiptPublic } from "./receipt";

const LIVE = "11111111-1111-4111-8111-000000000001";
const SANDBOX = "22222222-2222-4222-8222-000000000002";

const bill = (id: string, tenant_id: string): Row => ({
  id, tenant_id, doc_type: "invoice", status: "paid", number: "INV-0495", issued_at: "2026-11-03T08:00:00Z",
  subtotal_excl: "1000.00", vat_total: "150.00", total_incl: "1150.00", vat_breakdown: null,
  customer_id: null, customers: null, created_by: null, cash_session_id: null, bill_no: null,
});

// The sandbox row sits FIRST, so an unfiltered limit(1) picks it.
Object.assign(tables, {
  business_settings: [
    { id: SANDBOX, trading_name: "Carfectionist Sandbox", brn: null, vat_number: null, receipt_logo_path: null },
    { id: LIVE, trading_name: "Carfectionist", brn: "C22190760", vat_number: "VAT28070619", receipt_logo_path: null },
  ],
  documents: [bill("doc-live", LIVE), bill("doc-sandbox", SANDBOX)],
});

describe("getReceiptPublic", () => {
  it("names the live shop on a live customer's receipt", async () => {
    const r = await getReceiptPublic("doc-live");

    expect(r).toMatchObject({ studioName: "Carfectionist", brn: "C22190760", vatNo: "VAT28070619" });
  });

  it("names the sandbox on a sandbox receipt", async () => {
    const r = await getReceiptPublic("doc-sandbox");

    expect(r).toMatchObject({ studioName: "Carfectionist Sandbox", brn: "" });
  });
});
