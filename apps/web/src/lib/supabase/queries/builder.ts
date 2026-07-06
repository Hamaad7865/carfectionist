import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";
import { getSessionContext } from "@/lib/auth/session";
import { resolveDocAssets, type DocAssets } from "@/lib/pdf/assets";
import type { SectionFlags } from "@/lib/pdf/fiscal-lock";
import type { BuilderBusiness } from "@/features/documents/builder/toDocumentProps";

export interface CatalogueProduct {
  id: string;
  name: string;
  unitCents: number;
  vatRatePct: number;
  isStocked: boolean;
  kind: string;
}
export interface BuilderCustomer {
  id: string;
  name: string;
  country: string;
}
export interface BuilderContext {
  createdBy: string;
  business: BuilderBusiness;
  templateTerms: string[];
  templateConfig: Partial<SectionFlags>;
  customFieldDefs: { label: string; value: string }[];
  assets: DocAssets;
  products: CatalogueProduct[];
  customers: BuilderCustomer[];
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
    sb.from("products").select("id, name, selling_price, vat_rate, is_stocked, kind").eq("is_active", true).order("kind").order("name"),
    sb.from("customers").select("id, name, country").order("name"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bs: any = bsRes.data ?? {};
  const defaultVat = Number(bs.vat_rate ?? 15);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: any = tmplRes.data?.config ?? {};

  return {
    createdBy: session?.displayName?.replace(/\s*\(.*\)\s*$/, "").trim() ?? "",
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
    assets: resolveDocAssets(config),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    products: (prodRes.data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      unitCents: rupeesToCents(Number(p.selling_price)),
      vatRatePct: p.vat_rate != null ? Number(p.vat_rate) : defaultVat,
      isStocked: p.is_stocked,
      kind: p.kind,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customers: (custRes.data ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      country: c.country === "MU" ? "Mauritius" : (c.country ?? "Mauritius"),
    })),
  };
}

export interface LoadedDraft {
  docId: string;
  docType: "quote" | "invoice";
  status: string;
  number: string | null;
  customerId: string | null;
  revision: number;
  sectionConfig: Partial<SectionFlags>;
  customFields: { label: string; value: string }[];
  lines: {
    productId: string | null;
    title: string;
    description: string;
    qty: number;
    unitCents: number;
    discountPct: number;
    vatRatePct: number;
  }[];
}

export async function getDraft(id: string): Promise<LoadedDraft | null> {
  const sb = await createClient();
  const { data: doc } = await sb.from("documents").select("*").eq("id", id).maybeSingle();
  if (!doc) return null;
  const { data: lines } = await sb
    .from("document_lines")
    .select("*")
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
    customerId: d.customer_id,
    revision: d.revision,
    sectionConfig: flags as Partial<SectionFlags>,
    customFields: Array.isArray(cf) ? (cf as { label: string; value: string }[]) : [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: (lines ?? []).map((l: any) => ({
      productId: l.product_id,
      title: l.title,
      description: l.description ?? "",
      qty: Number(l.qty),
      unitCents: rupeesToCents(Number(l.unit_price)),
      discountPct: Number(l.discount_pct),
      vatRatePct: Number(l.vat_rate),
    })),
  };
}
