import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getZReportProps } from "@/lib/supabase/queries/render";
import { renderZReportPdf } from "@/lib/pdf/zreport-pdf";
import { PdfConfigError } from "@/lib/pdf/render";
import { sendZReportEmail } from "@/lib/email";
import { logAudit } from "@/lib/supabase/audit";

// Tablet entry point for "Email this Z-report": the POS calls this with the operator's
// Supabase access token as a Bearer header, same trust model as the document send route.
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return json({ ok: false, error: "unauthorized" }, 401);

  const sb = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: me } = await sb.auth.getUser(token);
  if (!me?.user) return json({ ok: false, error: "unauthorized" }, 401);

  // A Z-report is money data — same role floor as reports (owner/manager).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: appUser } = await (sb as any).from("app_users").select("id, role, tenant_id").eq("auth_user_id", me.user.id).eq("is_active", true).maybeSingle();
  const role = appUser?.role as string | undefined;
  if (!role || !["owner", "manager"].includes(role)) return json({ ok: false, error: "forbidden" }, 403);

  let body: { to?: string; deviceCode?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad request" }, 400);
  }
  const to = (body.to ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ ok: false, error: "That email address doesn't look right." }, 400);

  const props = await getZReportProps(id, sb);
  if (!props) return json({ ok: false, error: "Z-report not found." }, 404);

  const host = req.headers.get("host") ?? "app-carfectionist.com";
  const proto = host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("10.0.2.2") ? "http" : "https";

  let pdf: ArrayBuffer;
  try {
    pdf = await renderZReportPdf(props, `${proto}://${host}`);
  } catch (e) {
    if (e instanceof PdfConfigError) return json({ ok: false, error: "PDF generation isn't configured on this deployment." }, 422);
    return json({ ok: false, error: `Could not render the PDF: ${(e as Error).message}` }, 422);
  }

  const r = await sendZReportEmail({
    to,
    number: props.number,
    scope: props.scope,
    totalCents: Math.round(Number(props.totals?.total_incl ?? 0) * 100),
    closedAt: props.closedAt ? props.closedAt.slice(0, 16).replace("T", " ") : "",
    pdfBase64: Buffer.from(pdf).toString("base64"),
    studioName: props.from.tradingName,
  });
  if (!r.ok) return json(r, 422);

  await logAudit(sb, {
    tenantId: appUser.tenant_id,
    actorId: appUser.id,
    eventType: "z_report_sent",
    refType: "z_report",
    refId: id,
    payload: { to, number: props.number },
    deviceId: typeof body.deviceCode === "string" ? body.deviceCode : null,
  });
  return json({ ok: true });
}
