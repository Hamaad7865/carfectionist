/**
 * Which company issued a document, as the shop-identity fields its receipt and A4 print.
 *
 * A tenant can hold several issuing companies (legal_entities, 20261122000010) — the tyre
 * centre's VAT tyre company and non-VAT service company. The company's columns carry the same
 * names as business_settings', so the paper keeps reading one object: the default company is the
 * shop's own settings row exactly as before (Carfectionist prints byte-for-byte what it printed),
 * and any other company's identity is laid over it.
 */

/** The identity columns a company carries, named as on business_settings. */
export const ISSUER_FIELDS = [
  "legal_name", "trading_name", "brn", "vat_number", "address", "phone", "email",
  "bank_account_name", "bank_account_number", "bank_name",
  "receipt_logo_path", "receipt_header_text", "receipt_footer_text",
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface Issuer {
  /** business_settings with the issuing company's identity laid over it (when it is not the default). */
  shop: Row;
  /** False for a company that is not VAT-registered: its paper prints no VAT number and no VAT rows. */
  vatRegistered: boolean;
  /** The company is the shop's default — the paper reads exactly what it always read. */
  isDefault: boolean;
}

/** What two companies of one shop may share — where they trade from and how the paper looks.
 *  A company's LEGAL identity (names, BRN, VAT number) and its BANK account are never borrowed:
 *  a blank there prints blank, so a service invoice can never carry the tyre company's BRN or
 *  send a customer's money to the other company's account. */
const SHARED_FIELDS = new Set<string>([
  "address", "phone", "email", "receipt_logo_path", "receipt_header_text", "receipt_footer_text",
]);

/** Pure: lay a non-default company's identity over the settings row. */
export function overlayIssuer(settings: Row | null, company: Row | null): Issuer {
  const shop: Row = { ...(settings ?? {}) };
  if (!company || company.is_default) {
    return { shop, vatRegistered: company ? company.vat_registered !== false : true, isDefault: true };
  }
  for (const f of ISSUER_FIELDS) {
    const v = company[f];
    const blank = v == null || String(v).trim() === "";
    if (!blank) shop[f] = v;
    else if (!SHARED_FIELDS.has(f)) shop[f] = null;
  }
  // A company with no trading name trades under its legal name — never the other company's.
  if (!shop.trading_name) shop.trading_name = company.legal_name ?? null;
  const vatRegistered = company.vat_registered !== false;
  if (!vatRegistered) shop.vat_number = null;
  return { shop, vatRegistered, isDefault: false };
}

/** The issuer of a document: its own company if it names one, else the shop's default.
 *  A document that names a company we cannot read is an error, not the default company —
 *  printing the tyre company's VAT identity on a service company's bill is a wrong legal
 *  document, so it must fail loudly rather than look right. */
export async function issuerOf(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  doc: { tenant_id: string; legal_entity_id?: string | null },
  settings: Row | null,
): Promise<Issuer> {
  if (!doc.legal_entity_id) return overlayIssuer(settings, null);
  const { data, error } = await sb
    .from("legal_entities")
    .select(`id, is_default, vat_registered, ${ISSUER_FIELDS.join(", ")}`)
    .eq("id", doc.legal_entity_id)
    .eq("tenant_id", doc.tenant_id)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`issuing company ${doc.legal_entity_id} could not be read${error ? `: ${error.message}` : ""}`);
  }
  return overlayIssuer(settings, data as Row);
}
