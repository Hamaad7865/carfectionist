import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { rupeesToCents, formatMUR } from "@/lib/money";
import { muDateTime } from "@/lib/mu-date";
import { resolveDocAssets } from "@/lib/pdf/assets";
import type { DocumentA4Props } from "@/components/pdf/DocumentA4";

/** Assemble DocumentA4 props for a saved document (print route + PDF endpoint).
 *  Pass a client to override the cookie-bound one (the public tokenized PDF
 *  route has no session and supplies the service-role client instead). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getDocumentProps(id: string, sbOverride?: SupabaseClient<any>): Promise<DocumentA4Props | null> {
  const sb = sbOverride ?? (await createClient());
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

  // Acceptance stamp: signature PNG lives in the private vehicle-photos bucket;
  // a short-lived signed URL lets the PDF renderer (and the emailed copy) load it.
  let accepted: DocumentA4Props["accepted"] = null;
  const sig = d.accepted_signature as { path?: string; name?: string; at?: string } | null;
  if (sig) {
    let signatureUrl: string | null = null;
    if (sig.path) {
      const { data: signed } = await sb.storage.from("vehicle-photos").createSignedUrl(sig.path, 3600);
      signatureUrl = signed?.signedUrl ?? null;
    }
    accepted = { name: sig.name ?? null, at: sig.at ? muDateTime(sig.at) : null, signatureUrl };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grossSubtotalCents = ((lines ?? []) as any[]).reduce((s, l) => s + rupeesToCents(Number(l.line_total_excl)), 0);
  const discountExclCents = grossSubtotalCents - rupeesToCents(Number(d.subtotal_excl));
  const discountLabel =
    d.discount_kind === "percent" ? `${Number(d.discount_value)}%`
    : d.discount_kind === "amount" ? `${formatMUR(rupeesToCents(Number(d.discount_value)))} incl. VAT`
    : null;

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
      discountNote:
        l.discount_kind === "amount" && Number(l.discount_amount) > 0 ? `less ${formatMUR(rupeesToCents(Number(l.discount_amount)))}`
        : Number(l.discount_pct) > 0 ? `less ${Number(l.discount_pct)}%`
        : null,
    })),
    // Subtotal row = pre-order-discount ex-VAT sum; the order discount shows as its own row.
    subtotalCents: grossSubtotalCents,
    discountCents: discountExclCents > 0 ? discountExclCents : undefined,
    discountLabel: discountExclCents > 0 ? discountLabel : undefined,
    vatCents: rupeesToCents(Number(d.vat_total)),
    totalCents: rupeesToCents(Number(d.total_incl)),
    bank: {
      accountName: b.bank_account_name ?? "",
      accountNumber: b.bank_account_number ?? "",
      bankName: b.bank_name ?? "",
    },
    terms: Array.isArray(config.terms) ? config.terms : [],
    assets: resolveDocAssets(config),
    sectionConfig: d.template_overrides ?? {},
    customFields: Array.isArray(d.template_overrides?.customFields) ? d.template_overrides.customFields : [],
    accepted,
  };
}
