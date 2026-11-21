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

/** Pure: lay a non-default company's identity over the settings row. Blank company fields fall
 *  back to the shop's (a phone or address the two companies share). */
export function overlayIssuer(settings: Row | null, company: Row | null): Issuer {
  const shop: Row = { ...(settings ?? {}) };
  if (!company || company.is_default) {
    return { shop, vatRegistered: company ? company.vat_registered !== false : true, isDefault: true };
  }
  for (const f of ISSUER_FIELDS) {
    const v = company[f];
    if (v != null && String(v).trim() !== "") shop[f] = v;
  }
  const vatRegistered = company.vat_registered !== false;
  if (!vatRegistered) shop.vat_number = null;
  return { shop, vatRegistered, isDefault: false };
}

/** The issuer of a document: its own company if it names one, else the shop's default. */
export async function issuerOf(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  doc: { tenant_id: string; legal_entity_id?: string | null },
  settings: Row | null,
): Promise<Issuer> {
  if (!doc.legal_entity_id) return overlayIssuer(settings, null);
  const { data } = await sb
    .from("legal_entities")
    .select(`id, is_default, vat_registered, ${ISSUER_FIELDS.join(", ")}`)
    .eq("id", doc.legal_entity_id)
    .eq("tenant_id", doc.tenant_id)
    .maybeSingle();
  return overlayIssuer(settings, (data as Row | null) ?? null);
}
