import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";
import type { DocumentA4Props } from "@/components/pdf/DocumentA4";

/** Assemble DocumentA4 props for a saved document (print route + PDF endpoint). */
export async function getDocumentProps(id: string): Promise<DocumentA4Props | null> {
  const sb = await createClient();
  const { data: doc } = await sb
    .from("documents")
    .select("*, customers(name, country)")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return null;

  const [{ data: lines }, { data: bs }, { data: tmpl }] = await Promise.all([
    sb.from("document_lines").select("*").eq("document_id", id).order("sort_order"),
    sb.from("business_settings").select("*").limit(1).single(),
    sb.from("document_templates").select("config").eq("is_default", true).maybeSingle(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = doc;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = bs ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: any = tmpl?.config ?? {};

  let createdBy = "";
  if (d.created_by) {
    const { data: u } = await sb.from("app_users").select("display_name").eq("id", d.created_by).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createdBy = ((u as any)?.display_name ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
  }

  return {
    docType: d.doc_type,
    number: d.number,
    issueDate: d.issue_date,
    createdBy,
    from: {
      tradingName: b.trading_name ?? "Carfectionist",
      legalName: d.issued_legal_name ?? b.legal_name ?? "",
      country: "Mauritius",
      brn: d.issued_brn ?? b.brn ?? "",
      email: b.email ?? "",
      phone: b.phone ?? "",
      vatNo: d.issued_vat_number ?? b.vat_number ?? "",
    },
    billTo: {
      name: d.bill_to_name ?? d.customers?.name ?? "",
      country: d.customers?.country === "MU" ? "Mauritius" : (d.customers?.country ?? "Mauritius"),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: (lines ?? []).map((l: any) => ({
      title: l.title,
      detail: l.description,
      qty: Number(l.qty),
      rateCents: rupeesToCents(Number(l.unit_price)),
      amountCents: rupeesToCents(Number(l.line_total_excl)),
    })),
    subtotalCents: rupeesToCents(Number(d.subtotal_excl)),
    vatCents: rupeesToCents(Number(d.vat_total)),
    totalCents: rupeesToCents(Number(d.total_incl)),
    bank: {
      accountName: b.bank_account_name ?? "",
      accountNumber: b.bank_account_number ?? "",
      bankName: b.bank_name ?? "",
    },
    terms: Array.isArray(config.terms) ? config.terms : [],
    sectionConfig: d.template_overrides ?? {},
    customFields: Array.isArray(d.template_overrides?.customFields) ? d.template_overrides.customFields : [],
  };
}
