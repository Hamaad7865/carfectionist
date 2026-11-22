import { createClient } from "@/lib/supabase/server";

/**
 * The shop's issuing companies (legal_entities) for Settings → Companies. A tyre centre runs two:
 * the VAT-registered tyre company (the default — the business profile) and a non-VAT service
 * company. Read-only here; writes go through save_legal_entity (owner).
 */
export interface CompanyAdminRow {
  id: string;
  legalName: string;
  tradingName: string | null;
  brn: string | null;
  vatRegistered: boolean;
  vatNumber: string | null;
  vatRate: number;
  address: string | null;
  phone: string | null;
  email: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
  receiptHeaderText: string | null;
  receiptFooterText: string | null;
  quotePrefix: string;
  quoteNextNumber: number;
  quoteNumberPadding: number;
  invoicePrefix: string;
  invoiceNextNumber: number;
  invoiceNumberPadding: number;
  creditNotePrefix: string;
  creditNoteNextNumber: number;
  creditNoteNumberPadding: number;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Has issued at least one numbered document — numbering and VAT status are then fixed. */
  hasIssued: boolean;
  /** Active products sold by this company (the default also sells every product with none set). */
  products: number;
}

/** Display name: the trading name, else the legal name. */
export const companyName = (c: { tradingName: string | null; legalName: string }) => c.tradingName?.trim() || c.legalName;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export async function getCompaniesAdmin(): Promise<CompanyAdminRow[]> {
  const sb = await createClient();
  const { data } = await sb.from("legal_entities").select("*").order("sort_order").order("created_at");
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id as string);
  const [issued, products] = await Promise.all([
    Promise.all(
      ids.map((id) =>
        sb.from("documents").select("id", { count: "exact", head: true }).eq("legal_entity_id", id).not("number", "is", null)
          .then((r) => [id, (r.count ?? 0) > 0] as const),
      ),
    ),
    Promise.all(
      rows.map((r) => {
        let q = sb.from("products").select("id", { count: "exact", head: true }).eq("is_active", true);
        // A product with no company is sold by the default company.
        q = r.is_default ? q.or(`legal_entity_id.eq.${r.id},legal_entity_id.is.null`) : q.eq("legal_entity_id", r.id);
        return q.then((res) => [r.id as string, res.count ?? 0] as const);
      }),
    ),
  ]);
  const issuedBy = new Map(issued);
  const productsBy = new Map(products);
  return rows.map((r) => ({
    id: r.id,
    legalName: r.legal_name,
    tradingName: r.trading_name ?? null,
    brn: r.brn ?? null,
    vatRegistered: r.vat_registered !== false,
    vatNumber: r.vat_number ?? null,
    vatRate: Number(r.vat_rate ?? 0),
    address: r.address ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    bankAccountName: r.bank_account_name ?? null,
    bankAccountNumber: r.bank_account_number ?? null,
    bankName: r.bank_name ?? null,
    receiptHeaderText: r.receipt_header_text ?? null,
    receiptFooterText: r.receipt_footer_text ?? null,
    quotePrefix: r.quote_prefix,
    quoteNextNumber: r.quote_next_number,
    quoteNumberPadding: r.quote_number_padding,
    invoicePrefix: r.invoice_prefix,
    invoiceNextNumber: r.invoice_next_number,
    invoiceNumberPadding: r.invoice_number_padding,
    creditNotePrefix: r.credit_note_prefix,
    creditNoteNextNumber: r.credit_note_next_number,
    creditNoteNumberPadding: r.credit_note_number_padding,
    isDefault: r.is_default === true,
    isActive: r.is_active !== false,
    sortOrder: r.sort_order ?? 0,
    hasIssued: issuedBy.get(r.id) ?? false,
    products: productsBy.get(r.id) ?? 0,
  }));
}

/** The active companies, in order — for pickers (product "Sold by"). One-company shops get one. */
export async function getActiveCompanies(): Promise<{ id: string; name: string; isDefault: boolean; vatRegistered: boolean }[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("legal_entities")
    .select("id, legal_name, trading_name, is_default, vat_registered")
    .eq("is_active", true)
    .order("sort_order");
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    name: (r.trading_name ?? "").trim() || r.legal_name,
    isDefault: r.is_default === true,
    vatRegistered: r.vat_registered !== false,
  }));
}
