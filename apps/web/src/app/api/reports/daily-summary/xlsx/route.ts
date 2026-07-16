import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/supabase/audit";
import { getDailySummary } from "@/lib/supabase/queries/daily-summary";
import { parseSections, toExportRows } from "@/features/reports/daily-summary-sections";
import { buildXlsx } from "@/lib/xlsx";
import { muToday } from "@/lib/mu-date";

// The Daily Summary "Excel file" button. Same numbers as the screen (both build
// their columns from daily-summary-sections), but money goes out as real numbers
// so the sheet can be summed, not as formatted text.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSessionContext();
  if (!session || !["owner", "manager", "accountant"].includes(session.role)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const qFrom = url.searchParams.get("from");
  const qTo = url.searchParams.get("to");
  const from = isDay(qFrom) ? qFrom : `${muToday().slice(0, 8)}01`;
  const to = isDay(qTo) ? qTo : muToday();

  const summary = await getDailySummary(from, to);
  const sections = parseSections(url.searchParams.get("sec") ?? undefined);
  const bytes = buildXlsx("Daily summary", toExportRows(summary, sections));

  // Traceability: an export is a data egress — Cashmag logs it, so do we.
  try {
    const sb = await createClient();
    // actor_id is the app_users id, not the auth id — resolve it like the CSV exports do.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: au } = await (sb as any).from("app_users").select("id").eq("auth_user_id", session.userId).maybeSingle();
    await logAudit(sb, {
      tenantId: session.tenantId,
      actorId: (au?.id as string) ?? null,
      eventType: "data_export",
      payload: { report: "daily-summary", from, to, format: "xlsx" },
      deviceId: "back-office",
    });
  } catch {
    /* never fail the download because the audit write hiccuped */
  }

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="daily-summary_${from}_${to}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
