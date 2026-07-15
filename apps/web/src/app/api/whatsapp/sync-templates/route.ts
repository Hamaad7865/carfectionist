import { getSessionContext } from "@/lib/auth/session";
import { fetchTemplateStatuses } from "@/lib/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

// Owner-only: poll Meta directly for the live approval status of every template
// and reconcile our wa_templates rows. Use this when the app shows "pending" but
// you suspect the message_template_status_update webhook didn't deliver — it
// reads the truth straight from Meta and surfaces any rejection reason.
export const dynamic = "force-dynamic";

const MAP: Record<string, "pending" | "approved" | "rejected"> = {
  APPROVED: "approved", PENDING: "pending", IN_APPEAL: "pending", REJECTED: "rejected", PENDING_DELETION: "pending",
};

export async function GET() {
  const session = await getSessionContext();
  if (!session || session.role !== "owner") return new Response("forbidden", { status: 403 });

  const res = await fetchTemplateStatuses();
  if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 502 });

  const admin = createAdminClient();
  for (const t of res.data) {
    const status = MAP[t.status];
    if (!status) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("wa_templates")
      .update({ status, reject_reason: status === "rejected" ? t.reason : null, meta_template_id: t.id })
      .eq("name", t.name);
  }

  return Response.json({ ok: true, templates: res.data });
}
