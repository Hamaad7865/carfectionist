import { computeTotals, type DocDiscount, type DocumentTotals, type TotalsLineInput } from "@/lib/money";

/**
 * A two-company shop (tyre centre): a quote whose lines are sold by different issuing companies
 * goes out as ONE QUOTE PER COMPANY, each numbered in its own company's series.
 *
 * The split itself is the database's (app.split_by_company, reached through issue_checkout):
 * the lines move, the numbers come from issue_document. This module only mirrors its grouping so
 * the builder and the document page can SHOW the parts before and after — same company per line
 * (the product's company, else the shop's default company, as app.lines_stamp_entity stamps it),
 * same order (legal_entities.sort_order, then id). Totals here are a preview; the database is the
 * rounding authority.
 */

export interface SplitCompany {
  id: string;
  /** Trading name, else legal name. */
  name: string;
  legalName: string;
  vatRegistered: boolean;
  quotePrefix: string;
  sortOrder: number;
  isDefault: boolean;
}

/** One company's discount on its own quote: percent 0..100, or cents off the VAT-inclusive total. */
export interface CompanyDiscount {
  kind: "percent" | "amount";
  value: number;
  reason?: string | null;
}

export interface CompanyPart<L, C extends SplitCompany = SplitCompany> {
  company: C;
  /** Its place in the shop's company order — picks its colour (entityColours). */
  index: number;
  lines: L[];
  totals: DocumentTotals;
  discount: CompanyDiscount | null;
}

/** Companies in the order the database numbers them in (sort_order, then id). */
export function orderCompanies<C extends Pick<SplitCompany, "id" | "sortOrder">>(companies: C[]): C[] {
  return [...companies].sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function defaultCompanyId(companies: Pick<SplitCompany, "id" | "isDefault">[]): string | null {
  return companies.find((c) => c.isDefault)?.id ?? null;
}

/**
 * Which company sells this line. Mirrors app.lines_stamp_entity:
 *  - a catalogue line → its product's company; a product with no company → the default company;
 *  - a hand-typed line → THE DRAFT'S company as stored when it is saved (`draftCompanyId`), else
 *    the default. A draft takes its lines' company whenever they all share one
 *    (app.draft_follows_lines), so the builder passes the company its last save returned.
 */
export function lineCompanyId(
  productId: string | null,
  productCompany: ReadonlyMap<string, string | null>,
  companies: Pick<SplitCompany, "id" | "isDefault">[],
  draftCompanyId: string | null = null,
): string | null {
  const fallback = defaultCompanyId(companies);
  if (!productId) return draftCompanyId && companies.some((c) => c.id === draftCompanyId) ? draftCompanyId : fallback;
  const own = productCompany.get(productId) ?? null;
  return own && companies.some((c) => c.id === own) ? own : fallback;
}

/**
 * The quotes this document becomes, one per company that sells something on it, in company
 * order. One part (or none) means nothing is split: it stays one quote, exactly as today.
 */
export function splitByCompany<L extends TotalsLineInput, C extends SplitCompany = SplitCompany>(
  lines: L[],
  companyOf: (line: L) => string | null,
  companies: C[],
  discounts: Readonly<Record<string, CompanyDiscount>> = {},
): CompanyPart<L, C>[] {
  const ordered = orderCompanies(companies);
  const fallback = defaultCompanyId(companies);
  const byCompany = new Map<string, L[]>();
  for (const line of lines) {
    const id = companyOf(line) ?? fallback;
    if (!id) continue;
    const list = byCompany.get(id) ?? [];
    list.push(line);
    byCompany.set(id, list);
  }
  return ordered.flatMap((company, index) => {
    const own = byCompany.get(company.id);
    if (!own || own.length === 0) return [];
    const discount = activeDiscount(discounts[company.id]);
    const doc: DocDiscount | null = discount ? { kind: discount.kind, value: discount.value } : null;
    // A non-VAT company charges no VAT on any line (app.lines_stamp_entity forces vat_rate 0).
    const priced = company.vatRegistered ? own : own.map((l) => ({ ...l, vatRatePct: 0 }));
    return [{ company, index, lines: own, totals: computeTotals(priced, doc), discount }];
  });
}

export const spansCompanies = (parts: unknown[]): boolean => parts.length > 1;

export function combinedTotalCents(parts: { totals: DocumentTotals }[]): number {
  return parts.reduce((s, p) => s + p.totals.totalCents, 0);
}

function activeDiscount(d: CompanyDiscount | undefined | null): CompanyDiscount | null {
  if (!d || !(d.value > 0)) return null;
  if (d.kind !== "percent" && d.kind !== "amount") return null;
  return d;
}

// ── where the per-company discounts live on a draft ────────────────────────────────────────────
// A draft has ONE bill-discount field, and the database refuses it on a draft that spans companies
// (it could not say whose discount it is). So each company's discount rides in the draft's
// template_overrides under this key, survives a reload, and is handed to issue_checkout as
// p_discounts by whoever issues the draft (lib/supabase/issue-across-companies.ts).
export const COMPANY_DISCOUNTS_KEY = "companyDiscounts";

export function readCompanyDiscounts(overrides: unknown): Record<string, CompanyDiscount> {
  const raw = (overrides as Record<string, unknown> | null | undefined)?.[COMPANY_DISCOUNTS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, CompanyDiscount> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const d = v as Partial<CompanyDiscount> | null;
    if (!d || (d.kind !== "percent" && d.kind !== "amount")) continue;
    const value = Number(d.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (d.kind === "percent" && value > 100) continue;
    out[id] = { kind: d.kind, value: d.kind === "amount" ? Math.round(value) : value, reason: typeof d.reason === "string" ? d.reason : null };
  }
  return out;
}

/** issue_checkout's p_discounts, for the companies actually on the draft. An amount travels in
 *  VAT-inclusive RUPEES (as save_draft takes a bill discount); a percent as itself. */
export function toCheckoutDiscounts(
  discounts: Readonly<Record<string, CompanyDiscount>>,
  companyIds: string[],
): { legal_entity_id: string; discount_kind: "percent" | "amount"; discount_value: number; discount_reason: string | null }[] {
  return companyIds.flatMap((id) => {
    const d = activeDiscount(discounts[id]);
    if (!d) return [];
    return [{
      legal_entity_id: id,
      discount_kind: d.kind,
      discount_value: d.kind === "amount" ? d.value / 100 : d.value,
      discount_reason: d.reason?.trim() || null,
    }];
  });
}
