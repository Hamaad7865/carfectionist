"use server";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getZReportProps } from "@/lib/supabase/queries/render";
import { renderZReportPdf } from "@/lib/pdf/zreport-pdf";
import { PdfConfigError } from "@/lib/pdf/render";
import { sendZReportEmail } from "@/lib/email";
import { logAudit } from "@/lib/supabase/audit";

// Z-reports are money data — same role floor as Reports (owner/manager only,
// no accountant: the tablet send route already enforces this).
const ROLES = ["owner", "manager"] as const;
type Result = { ok: true } | { ok: false; error: string };

/** Email a closed Z-report as a PDF, re-rendered from its frozen totals. */
export async function sendZReportEmailAction(zId: string, to: string): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const addr = to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return { ok: false, error: "That email address doesn't look right." };

  const sb = await createClient();
  const { headers } = await import("next/headers");
  const host = (await headers()).get("host") ?? "app-carfectionist.com";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";

  const props = await getZReportProps(zId, sb);
  if (!props) return { ok: false, error: "Z-report not found." };

  let pdf: ArrayBuffer;
  try {
    pdf = await renderZReportPdf(props, `${proto}://${host}`);
  } catch (e) {
    if (e instanceof PdfConfigError) return { ok: false, error: "PDF generation isn't configured on this deployment." };
    return { ok: false, error: `Could not render the Z-report: ${(e as Error).message}` };
  }

  const periodTotals =
    props.totals?.period && typeof props.totals.period === "object" ? props.totals.period : props.totals;

  const r = await sendZReportEmail({
    to: addr,
    number: props.number,
    scope: props.scope,
    totalCents: Math.round(Number(periodTotals?.total_incl ?? 0) * 100),
    closedAt: props.closedAt ? props.closedAt.slice(0, 16).replace("T", " ") : "",
    pdfBase64: Buffer.from(pdf).toString("base64"),
    studioName: props.from.tradingName,
  });
  if (!r.ok) return r;

  const { data: actor } = await sb.from("app_users").select("id").eq("auth_user_id", ctx.userId).maybeSingle();
  await logAudit(sb, {
    tenantId: ctx.tenantId,
    actorId: (actor as { id: string } | null)?.id ?? null,
    eventType: "z_report_sent",
    refType: "z_report",
    refId: zId,
    payload: { to: addr, number: props.number },
  });
  return { ok: true };
}
