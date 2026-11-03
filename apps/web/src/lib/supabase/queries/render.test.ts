import { describe, expect, it, vi } from "vitest";

// The share link and the scheduled-send cron render on the service role, where RLS no
// longer narrows business_settings to one row. Every builder has to read the shop that
// owns the document, not whichever row Postgres hands back first — the live shop sat
// first only by heap order, and the sandbox's name with no BRN on a customer's invoice
// is what one settings edit away looked like.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/pdf/assets", () => ({ resolveDocAssets: async () => ({}) }));
const aged = vi.fn();
vi.mock("@/lib/supabase/queries/reports", () => ({ getCustomerAgedStatement: (...a: unknown[]) => aged(...a) }));

import { getDocumentProps, getStatementProps, getZReportProps } from "./render";

type Row = Record<string, unknown>;

/** A service-role client over fixture tables: filters really filter, and single /
 *  maybeSingle refuse the row counts PostgREST refuses. */
function serviceRole(tables: Record<string, Row[]>) {
  return {
    from: (table: string) => {
      let rows = [...(tables[table] ?? [])];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => ((rows = rows.filter((r) => r[col] === val)), q),
        order: () => q,
        limit: (n: number) => ((rows = rows.slice(0, n)), q),
        single: async () =>
          rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `${rows.length} rows` } },
        maybeSingle: async () =>
          rows.length > 1 ? { data: null, error: { message: "multiple rows" } } : { data: rows[0] ?? null, error: null },
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok, ko),
      };
      return q;
    },
  } as never;
}

const LIVE = "11111111-1111-4111-8111-000000000001";
const SANDBOX = "22222222-2222-4222-8222-000000000002";

// The sandbox row sits FIRST, so an unfiltered limit(1) picks it.
const shops: Row[] = [
  { id: SANDBOX, trading_name: "Carfectionist Sandbox", legal_name: "TEST SANDBOX — NOT A REAL COMPANY", brn: null, vat_number: null },
  { id: LIVE, trading_name: "Carfectionist", legal_name: "Diamondbrite Reunion (Mauritius) Ltd", brn: "C22190760", vat_number: "VAT28070619" },
];

const templates: Row[] = [
  { tenant_id: SANDBOX, doc_type: null, is_default: true, config: { terms: ["Sandbox terms"] } },
  { tenant_id: LIVE, doc_type: null, is_default: true, config: { terms: ["Goods remain our property until paid.", "Bank transfer within 30 days."] } },
];

// A draft carries no frozen issued_brn, so the BRN printed is the shop row's own —
// the case the issued_brn ?? fallback would otherwise hide.
const doc = (id: string, tenant_id: string): Row => ({
  id, tenant_id, doc_type: "invoice", status: "draft", number: null, issue_date: null,
  issued_legal_name: null, issued_brn: null, issued_vat_number: null,
  subtotal_excl: "1000.00", vat_total: "150.00", total_incl: "1150.00",
  discount_kind: null, discount_value: null, created_by: null, accepted_signature: null,
  template_overrides: {}, customers: { name: "INTERGRAH LTEE", country: "MU" },
});

const db = (extra: Record<string, Row[]> = {}) =>
  serviceRole({
    business_settings: shops,
    document_templates: templates,
    documents: [doc("doc-live", LIVE), doc("doc-sandbox", SANDBOX)],
    document_lines: [],
    ...extra,
  });

describe("getDocumentProps on the service role", () => {
  it("prints the live shop's name, BRN and terms on a live invoice", async () => {
    const p = await getDocumentProps("doc-live", db());

    expect(p?.from).toMatchObject({ tradingName: "Carfectionist", brn: "C22190760", vatNo: "VAT28070619" });
    expect(p?.from.legalName).toBe("Diamondbrite Reunion (Mauritius) Ltd");
    expect(p?.terms).toEqual(["Goods remain our property until paid.", "Bank transfer within 30 days."]);
  });

  it("prints the sandbox's own header and terms on a sandbox document", async () => {
    const p = await getDocumentProps("doc-sandbox", db());

    expect(p?.from).toMatchObject({ tradingName: "Carfectionist Sandbox", brn: "" });
    expect(p?.terms).toEqual(["Sandbox terms"]);
  });

  it("never lends the live shop's template to a tenant that has none", async () => {
    const p = await getDocumentProps("doc-sandbox", db({ document_templates: [templates[1]] }));

    expect(p?.terms).toEqual([]);
  });

  // Which default wins is not decided here (limit(1), unordered) — only that two of them
  // no longer blank the terms out.
  it("keeps terms when a shop holds a default per document type", async () => {
    const perType = { tenant_id: LIVE, doc_type: "quote", is_default: true, config: { terms: ["Quote valid 14 days."] } };
    const p = await getDocumentProps("doc-live", db({ document_templates: [templates[1], perType] }));

    expect(p?.terms?.length).toBeGreaterThan(0);
  });
});

describe("getZReportProps on the service role", () => {
  it("heads a live Z-report with the live shop", async () => {
    const p = await getZReportProps("z-live", db({ z_reports: [{ id: "z-live", tenant_id: LIVE, number: "Z000120", scope: "day", totals: {} }] }));

    expect(p?.from).toMatchObject({ tradingName: "Carfectionist", brn: "C22190760" });
  });
});

describe("getStatementProps on the service role", () => {
  it("heads a live customer's statement with the live shop", async () => {
    aged.mockResolvedValue({ customerName: "INTERGRAH LTEE", refDate: "2026-11-03", soldeCents: 0, buckets: [], carriedCents: 0, invoices: [] });
    const p = await getStatementProps("cust-live", db({ customers: [{ id: "cust-live", tenant_id: LIVE }] }));

    expect(p?.from).toMatchObject({ tradingName: "Carfectionist", brn: "C22190760" });
  });
});
