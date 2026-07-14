"use server";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getStatementProps } from "@/lib/supabase/queries/render";
import { renderStatementPdf } from "@/lib/pdf/statement-pdf";
import { PdfConfigError } from "@/lib/pdf/render";
import { sendStatementEmail } from "@/lib/email";
import { logAudit } from "@/lib/supabase/audit";

// Statements are receivables — accounting only, same floor as the Reports module.
const ROLES = ["owner", "manager", "accountant"] as const;
type Result = { ok: true } | { ok: false; error: string };

/**
 * Email a customer their statement of account as a PDF. The web has no till, so this
 * is a straight email — the statement is a ledger, not a fiscal document that needs the
 * WhatsApp/document machinery.
 */
export async function sendStatementEmailAction(customerId: string, to: string): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const addr = to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return { ok: false, error: "That email address doesn't look right." };

  const sb = await createClient();
  const { headers } = await import("next/headers");
  const host = (await headers()).get("host") ?? "app-carfectionist.com";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";

  const props = await getStatementProps(customerId, sb);
  if (!props) return { ok: false, error: "Customer not found." };

  let pdf: ArrayBuffer;
  try {
    pdf = await renderStatementPdf(props, `${proto}://${host}`);
  } catch (e) {
    if (e instanceof PdfConfigError) return { ok: false, error: "PDF generation isn't configured on this deployment." };
    return { ok: false, error: `Could not render the statement: ${(e as Error).message}` };
  }

  const r = await sendStatementEmail({
    to: addr,
    customerName: props.customerName,
    balanceCents: props.soldeCents,
    refDate: props.refDate,
    pdfBase64: Buffer.from(pdf).toString("base64"),
    studioName: props.from.tradingName,
  });
  if (!r.ok) return r;

  const { data: actor } = await sb.from("app_users").select("id").eq("auth_user_id", ctx.userId).maybeSingle();
  await logAudit(sb, {
    tenantId: ctx.tenantId,
    actorId: (actor as { id: string } | null)?.id ?? null,
    eventType: "statement_sent",
    refType: "customer",
    refId: customerId,
    payload: { to: addr, balanceCents: props.soldeCents },
  });
  return { ok: true };
}
