import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { rupeesToCents, formatMUR, grossCents } from "@/lib/money";
import { muDateTime } from "@/lib/mu-date";
import { resolveDocAssets } from "@/lib/pdf/assets";
import type { DocumentA4Props } from "@/components/pdf/DocumentA4";
import type { StatementA4Props } from "@/components/pdf/StatementA4";
import type { ZReportA4Props } from "@/components/pdf/ZReportA4";
import { getCustomerAgedStatement } from "@/lib/supabase/queries/reports";

/** Assemble ZReportA4 props for a closed till's Z-report — the frozen totals plus the
 *  business header. Shared by the Z-report PDF endpoint and the email path. */
export async function getZReportProps(id: string, sbOverride?: SupabaseClient<any>): Promise<ZReportA4Props | null> {
  const sb = sbOverride ?? (await createClient());
  const { data: z } = await sb.from("z_reports").select("number, scope, totals, note, closed_at").eq("id", id).maybeSingle();
  if (!z) return null;
  const { data: bs } = await sb.from("business_settings").select("*").limit(1).single();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = bs ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = z;
  return {
    from: {
      tradingName: b.trading_name ?? "Carfectionist",
      address: b.address ?? "",
      brn: b.brn ?? "",
      vatNo: b.vat_number ?? "",
      phone: b.phone ?? "",
    },
    number: d.number,
    scope: d.scope,
    closedAt: d.closed_at ?? null,
    note: d.note ?? null,
    totals: d.totals ?? {},
  };
}

/** Assemble StatementA4 props for a customer — the aged balance plus the business
 *  header, shared by the statement PDF endpoint and the email path. */
export async function getStatementProps(customerId: string, sbOverride?: SupabaseClient<any>): Promise<StatementA4Props | null> {
  const sb = sbOverride ?? (await createClient());
  const aged = await getCustomerAgedStatement(customerId);
  if (!aged) return null;

  const { data: bs } = await sb.from("business_settings").select("*").limit(1).single();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = bs ?? {};

  const fmtDate = (iso: string) =>
    iso ? new Date(`${iso}T00:00:00+04:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Indian/Mauritius" }) : "—";

  return {
    from: {
      tradingName: b.trading_name ?? "Carfectionist",
      legalName: b.legal_name ?? "",
      country: "Mauritius",
      brn: b.brn ?? "",
      email: b.email ?? "",
      phone: b.phone ?? "",
      vatNo: b.vat_number ?? "",
    },
    customerName: aged.customerName,
    refDate: fmtDate(aged.refDate),
    soldeCents: aged.soldeCents,
    buckets: aged.buckets.map((bk) => ({ label: bk.label, cents: bk.cents })),
    carriedCents: aged.carriedCents,
    invoices: aged.invoices.map((inv) => ({
      date: fmtDate(inv.date),
      number: inv.number,
      detail: inv.lines.length ? inv.lines.map((l) => `${l.qty} × ${l.title}${l.discountPct ? ` (−${l.discountPct}%)` : ""}`).join(" · ") : "—",
      debitCents: inv.debitCents,
      creditCents: inv.creditCents,
    })),
  };
}

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

  // The shop quotes VAT-INCLUSIVE shelf prices, so the customer's copy should state them
  // that way — the same figure they were told at the counter. Money is stored net (the DB's
  // generated columns add VAT), so this is a presentation change only, per line at its own
  // rate. Subtotal(incl) − Discount(incl) = Total exactly, so the column still adds up.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inclVat = (b as any)?.prices_vat_exclusive === false;
  const totalInclCents = rupeesToCents(Number(d.total_incl));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subtotalInclCents = ((lines ?? []) as any[]).reduce(
    (s, l) => s + rupeesToCents(Number(l.line_total_excl)) + rupeesToCents(Number(l.line_vat)),
    0,
  );
  const discountInclCents = subtotalInclCents - totalInclCents;
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
      // The Rate column states the SHELF price — what the customer was quoted and what the
      // tablet shows — via the same two-step, half-away-from-zero rounding the DB uses, so a
      // discount line's Rate can't land a cent off its own Amount. Note qty × Rate can still
      // differ a cent or two from Amount when the stored net doesn't divide the shelf price
      // evenly (Rs 100 stores as 86.96); Amount stays the ledger's figure so the column always
      // foots to the TOTAL, which matters more on a fiscal document than the multiplication.
      rateCents: inclVat
        ? grossCents(rupeesToCents(Number(l.unit_price)), Number(l.vat_rate))
        : rupeesToCents(Number(l.unit_price)),
      amountCents: inclVat
        ? rupeesToCents(Number(l.line_total_excl)) + rupeesToCents(Number(l.line_vat))
        : rupeesToCents(Number(l.line_total_excl)),
      discountNote:
        l.discount_kind === "amount" && Number(l.discount_amount) > 0 ? `less ${formatMUR(rupeesToCents(Number(l.discount_amount)))}`
        : Number(l.discount_pct) > 0 ? `less ${Number(l.discount_pct)}%`
        : null,
    })),
    // Subtotal row = pre-order-discount ex-VAT sum; the order discount shows as its own row.
    subtotalCents: inclVat ? subtotalInclCents : grossSubtotalCents,
    discountCents: inclVat
      ? (discountInclCents > 0 ? discountInclCents : undefined)
      : (discountExclCents > 0 ? discountExclCents : undefined),
    discountLabel: (inclVat ? discountInclCents > 0 : discountExclCents > 0) ? discountLabel : undefined,
    vatCents: rupeesToCents(Number(d.vat_total)),
    totalCents: totalInclCents,
    vatInclusive: inclVat,
    bank: {
      accountName: b.bank_account_name ?? "",
      accountNumber: b.bank_account_number ?? "",
      bankName: b.bank_name ?? "",
    },
    terms: Array.isArray(config.terms) ? config.terms : [],
    assets: await resolveDocAssets(sb, config),
    sectionConfig: d.template_overrides ?? {},
    customFields: Array.isArray(d.template_overrides?.customFields) ? d.template_overrides.customFields : [],
    accepted,
  };
}
