import { createClient } from "@/lib/supabase/server";
import { rupeesToCents, policyOf, CARWASH_MAX_PCT, DEFAULT_POLICIES, type DiscountPolicy, type PolicyDefaults } from "@/lib/money";

/** The owner's live discount rules, read from business_settings and handed to the
 *  builder so its clamp uses the same cap and per-kind fallbacks the DB enforces. */
export interface PosRules {
  carwashPct: number;
  policyDefaults: PolicyDefaults;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function posRulesFrom(bs: any): PosRules {
  const policy = (v: unknown, fallback: DiscountPolicy): DiscountPolicy =>
    v === "none" || v === "carwash" || v === "free" ? v : fallback;
  return {
    carwashPct: Number.isFinite(Number(bs?.discount_carwash_pct)) ? Number(bs.discount_carwash_pct) : CARWASH_MAX_PCT,
    policyDefaults: {
      service: policy(bs?.default_policy_service, DEFAULT_POLICIES.service),
      goods: policy(bs?.default_policy_goods, DEFAULT_POLICIES.goods),
    },
  };
}
import { getSessionContext } from "@/lib/auth/session";
import { resolveDocAssets, type DocAssets } from "@/lib/pdf/assets";
import { productPhotoUrl } from "@/lib/supabase/storage";
import type { SectionFlags } from "@/lib/pdf/fiscal-lock";
import { parseRichDoc } from "@/lib/rich/schema";
import type { RichDoc } from "@/lib/rich/types";
import type { BuilderBusiness } from "@/features/documents/builder/toDocumentProps";

export interface CatalogueProduct {
  id: string;
  name: string;
  unitCents: number;
  vatRatePct: number;
  isStocked: boolean;
  kind: string;
  /** How much of this product may be discounted: inherit | none | carwash | free. */
  discountPolicy: string;
  /** True: unitCents IS the VAT-inclusive shelf price exactly as typed (20260812000030) —
   *  a line from it is flagged and the ledger extracts the VAT, so it lands on the figure. */
  priceIncludesVat: boolean;
  photoUrl: string | null;
}
export interface BuilderCustomer {
  id: string;
  name: string;
  country: string;
  email: string | null;
  phone: string | null;
  /** A business client's own fiscal numbers — null for an individual. Previewed on the A4 the
   *  same way the printed/emailed PDF prints them. */
  brn: string | null;
  vatNo: string | null;
}
export interface BuilderContext {
  createdBy: string;
  /** The shop quotes VAT-INCLUSIVE shelf prices — show/accept gross. Lines still save net. */
  pricesInclVat: boolean;
  business: BuilderBusiness;
  templateTerms: string[];
  templateConfig: Partial<SectionFlags>;
  customFieldDefs: { label: string; value: string }[];
  assets: DocAssets;
  products: CatalogueProduct[];
  customers: BuilderCustomer[];
  posRules: PosRules;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSectionConfig(config: any): Partial<SectionFlags> {
  return {
    bankDetails: config?.show_bank_details ?? true,
    terms: config?.show_terms ?? true,
    signature: config?.show_signature ?? false,
  };
}

export async function getBuilderContext(): Promise<BuilderContext> {
  const sb = await createClient();
  const session = await getSessionContext();
  const [bsRes, tmplRes, prodRes, custRes] = await Promise.all([
    sb.from("business_settings").select("*").limit(1).single(),
    sb.from("document_templates").select("config").eq("is_default", true).limit(1).maybeSingle(),
    sb.from("products").select("id, name, selling_price, price_includes_vat, vat_rate, is_stocked, kind, photo_path, discount_policy").eq("is_active", true).order("kind").order("name"),
    sb.from("customers").select("id, name, country, email, phone, brn, vat_number").order("name"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bs: any = bsRes.data ?? {};
  const defaultVat = Number(bs.vat_rate ?? 15);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: any = tmplRes.data?.config ?? {};

  return {
    createdBy: session?.displayName?.replace(/\s*\(.*\)\s*$/, "").trim() ?? "",
    pricesInclVat: bs.prices_vat_exclusive === false,
    posRules: posRulesFrom(bs),
    business: {
      tradingName: bs.trading_name ?? "Carfectionist",
      legalName: bs.legal_name ?? "",
      country: bs.country === "MU" ? "Mauritius" : (bs.country ?? "Mauritius"),
      brn: bs.brn ?? "",
      email: bs.email ?? "",
      phone: bs.phone ?? "",
      vatNo: bs.vat_number ?? "",
      bankAccountName: bs.bank_account_name ?? "",
      bankAccountNumber: bs.bank_account_number ?? "",
      bankName: bs.bank_name ?? "",
    },
    templateTerms: Array.isArray(config.terms) ? config.terms : [],
    templateConfig: toSectionConfig(config),
    customFieldDefs: Array.isArray(config.custom_fields)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (config.custom_fields as any[]).map((f) => ({ label: String(f?.label ?? ""), value: String(f?.value ?? "") })).filter((f) => f.label.length > 0)
      : [],
    assets: await resolveDocAssets(sb, config),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    products: (prodRes.data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      unitCents: rupeesToCents(Number(p.selling_price)),
      vatRatePct: p.vat_rate != null ? Number(p.vat_rate) : defaultVat,
      isStocked: p.is_stocked,
      kind: p.kind,
      discountPolicy: p.discount_policy,
      priceIncludesVat: p.price_includes_vat === true,
      photoUrl: productPhotoUrl(p.photo_path),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customers: (custRes.data ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      country: c.country === "MU" ? "Mauritius" : (c.country ?? "Mauritius"),
      email: c.email ?? null,
      phone: c.phone ?? null,
      brn: c.brn ?? null,
      vatNo: c.vat_number ?? null,
    })),
  };
}

export interface LoadedDraft {
  docId: string;
  docType: "quote" | "invoice";
  status: string;
  number: string | null;
  issueDate: string | null;
  customerId: string | null;
  revision: number;
  docDiscountKind: "percent" | "amount" | null;
  docDiscountValue: number; // percent: % ; amount: Cents (VAT-inclusive)
  docDiscountReason: string;
  sectionConfig: Partial<SectionFlags>;
  customFields: { label: string; value: string }[];
  comment: string;
  lines: {
    productId: string | null;
    title: string;
    description: string;
    rich: RichDoc | null;
    unitLabel: string;
    qty: number;
    unitCents: number;
    discountPct: number;
    discountKind: "percent" | "amount";
    discountAmountCents: number;
    discountPolicy: DiscountPolicy;
    vatRatePct: number;
    lineKind: "service" | "product" | null;
    /** price_includes_vat: the stored unit IS the typed gross (20260812000020). */
    priceInclusive: boolean;
  }[];
}

export async function getDraft(id: string): Promise<LoadedDraft | null> {
  const sb = await createClient();
  const { data: doc } = await sb.from("documents").select("*").eq("id", id).maybeSingle();
  if (!doc) return null;
  // The owner's per-kind fallbacks, so a reopened inherit line resolves its policy the
  // same way a fresh one does and the same way the DB re-derives it.
  const { data: bsRow } = await sb
    .from("business_settings")
    .select("default_policy_service, default_policy_goods")
    .limit(1)
    .maybeSingle();
  const policyDefaults = posRulesFrom(bsRow).policyDefaults;
  const { data: lines } = await sb
    .from("document_lines")
    // products(discount_policy, kind) rides along so a reopened line clamps its discount
    // the same way a freshly added one does — the same join app.document_discount_limits uses.
    .select("*, products(discount_policy, kind)")
    .eq("document_id", id)
    .order("sort_order");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = doc;
  const to = (d.template_overrides ?? {}) as Record<string, unknown>;
  const { customFields: cf, ...flags } = to;
  return {
    docId: d.id,
    docType: d.doc_type,
    status: d.status,
    number: d.number,
    issueDate: d.issue_date ?? null,
    customerId: d.customer_id,
    revision: d.revision,
    docDiscountKind: d.discount_kind ?? null,
    docDiscountValue: d.discount_kind === "amount" ? rupeesToCents(Number(d.discount_value)) : Number(d.discount_value ?? 0),
    docDiscountReason: d.discount_reason ?? "",
    sectionConfig: flags as Partial<SectionFlags>,
    customFields: Array.isArray(cf) ? (cf as { label: string; value: string }[]) : [],
    comment: d.comment ?? "",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: (lines ?? []).map((l: any) => ({
      productId: l.product_id,
      title: l.title,
      description: l.description ?? "",
      rich: parseRichDoc(l.description_richtext),
      unitLabel: l.unit_label ?? "",
      qty: Number(l.qty),
      unitCents: rupeesToCents(Number(l.unit_price)),
      discountPct: Number(l.discount_pct),
      discountKind: (l.discount_kind ?? "percent") as "percent" | "amount",
      discountAmountCents: rupeesToCents(Number(l.discount_amount ?? 0)),
      // A catalogue line's product answers; an ad-hoc line's own line_kind does — the
      // same fallback app.document_discount_limits computes server-side.
      discountPolicy: policyOf(l.products?.discount_policy ?? null, l.line_kind ?? l.products?.kind ?? "service", policyDefaults),
      vatRatePct: Number(l.vat_rate),
      // Only a hand-typed line ever stated one; a catalogue line reads null and
      // lets its product answer.
      lineKind: (l.line_kind ?? null) as "service" | "product" | null,
      // The stored unit IS the typed gross on a flagged line — the builder shows and
      // clamps it as such rather than re-grossing (price_includes_vat, 20260812000020).
      priceInclusive: l.price_includes_vat === true,
    })),
  };
}
