import type { SupabaseClient } from "@supabase/supabase-js";
import { getDocumentProps } from "@/lib/supabase/queries/render";
import { renderDocumentPdf } from "@/lib/pdf/document-pdf";
import { PdfConfigError } from "@/lib/pdf/render";
import { sendDocumentEmail } from "@/lib/email";
import { docToken } from "@/lib/receipt-token";
import { normalizePhoneMU } from "@/lib/phone";
import { firstName } from "@/features/marketing/render";
import { createAdminClient } from "@/lib/supabase/admin";
import * as wa from "@/lib/whatsapp";

// One send path for tablet + web: render the exact document PDF and deliver it
// by email (attachment + download link) or WhatsApp (utility template with a
// DOCUMENT header — Meta fetches the tokenized public PDF URL).
//
// The WhatsApp route needs a Meta-approved utility template. We bootstrap it
// on first use: insert the wa_templates row + submit to Meta, and tell the
// operator to retry once it's approved (usually minutes).

const DOC_TEMPLATE = {
  name: "document_delivery",
  language: "en",
  category: "UTILITY",
  body: "Hello {{1}}, here is your {{2}} {{3}} from Carfectionist. Thank you for your business.",
  variableExamples: ["Anesh", "quotation", "A00120"],
  headerFormat: "DOCUMENT" as const,
};

export interface SendDocumentInput {
  sb: SupabaseClient; // RLS-scoped client of the operator (cookie or bearer)
  docId: string;
  channel: "email" | "whatsapp";
  to: string;
  saveContact?: boolean;
  origin: string; // https://app-carfectionist.com — for the public PDF link
  deviceCode?: string | null; // stamps the traceability event when sent from a tablet
}

export type SendDocumentResult = { ok: true } | { ok: false; error: string };

const KIND_LABEL: Record<string, string> = { quote: "quotation", invoice: "invoice", credit_note: "credit note" };

export async function sendDocument(i: SendDocumentInput): Promise<SendDocumentResult> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const sb = i.sb as SupabaseClient<any>;

  // Load the document through the operator's RLS — also proves they may see it.
  const { data: doc } = await sb
    .from("documents")
    .select("id, tenant_id, doc_type, number, status, total_incl, customer_id, accepted_signature, customers(name)")
    .eq("id", i.docId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Document not found." };
  const d: any = doc;
  if (!d.number) return { ok: false, error: "This document is still a draft — issue or accept it first." };
  const kind = KIND_LABEL[d.doc_type] ?? "document";
  const customerName: string = d.customers?.name ?? "customer";

  const to = i.to.trim();
  if (!to) return { ok: false, error: "Enter where to send it." };

  if (i.channel === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: "That email address doesn't look right." };

    const props = await getDocumentProps(i.docId, sb);
    if (!props) return { ok: false, error: "Document not found." };
    let pdf: ArrayBuffer;
    try {
      pdf = await renderDocumentPdf(props, i.origin);
    } catch (e) {
      if (e instanceof PdfConfigError) return { ok: false, error: "PDF generation isn't configured on this deployment." };
      return { ok: false, error: `Could not render the PDF: ${(e as Error).message}` };
    }
    const link = `${i.origin}/api/public/doc/${encodeURIComponent(await docToken(i.docId))}/pdf`;
    const r = await sendDocumentEmail({
      to,
      docKind: kind,
      number: d.number,
      customerName,
      totalCents: Math.round(Number(d.total_incl) * 100),
      accepted: !!d.accepted_signature,
      pdfBase64: Buffer.from(pdf).toString("base64"),
      downloadLink: link,
      studioName: "Carfectionist",
    });
    if (!r.ok) return r;
  } else {
    const phone = normalizePhoneMU(to);
    if (!phone) return { ok: false, error: "That phone number doesn't look right." };
    if (!wa.isConfigured()) return { ok: false, error: "WhatsApp isn't connected yet — finish the Meta setup first." };

    // The utility template is server-managed bookkeeping (owner-only RLS would
    // block non-owner operators) → admin client for wa_templates only.
    const admin = createAdminClient();
    const { data: tpl } = await admin
      .from("wa_templates")
      .select("id, status")
      .eq("name", DOC_TEMPLATE.name)
      .eq("language", DOC_TEMPLATE.language)
      .maybeSingle();

    if (!tpl) {
      const sub = await wa.submitTemplate(DOC_TEMPLATE);
      if (!sub.ok) return sub;
      await admin.from("wa_templates").insert({
        tenant_id: d.tenant_id,
        name: DOC_TEMPLATE.name,
        language: DOC_TEMPLATE.language,
        category: DOC_TEMPLATE.category,
        body: DOC_TEMPLATE.body,
        variable_count: 3,
        status: "pending",
        meta_template_id: sub.data.id,
      });
      return { ok: false, error: "One-time setup: the document template was just submitted to WhatsApp for approval. Try again in a few minutes." };
    }
    if (tpl.status !== "approved") {
      return { ok: false, error: "The WhatsApp document template is still pending approval — try again shortly (or press Sync approvals in Marketing)." };
    }

    const link = `${i.origin}/api/public/doc/${encodeURIComponent(await docToken(i.docId))}/pdf`;
    const r = await wa.sendDocumentTemplate(
      phone,
      DOC_TEMPLATE.name,
      DOC_TEMPLATE.language,
      [firstName(customerName) || "there", kind, d.number],
      { link, filename: `${d.number}.pdf` },
    );
    if (!r.ok) return r;
  }

  // Optionally save a newly-captured address/number back onto the customer.
  if (i.saveContact && d.customer_id) {
    const patch = i.channel === "email" ? { email: to } : { phone: to };
    await sb.from("customers").update(patch).eq("id", d.customer_id);
  }

  // Traceability: who sent what where (device-stamped when from a tablet).
  const { data: me } = await sb.auth.getUser();
  const { data: appUser } = me?.user
    ? await sb.from("app_users").select("id").eq("auth_user_id", me.user.id).maybeSingle()
    : { data: null };
  await sb.from("audit_events").insert({
    tenant_id: d.tenant_id,
    actor_id: (appUser as any)?.id ?? null,
    event_type: "document_sent",
    ref_type: "document",
    ref_id: d.id,
    payload: { channel: i.channel, to, number: d.number, kind },
    device_id: i.deviceCode ?? null,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { ok: true };
}
