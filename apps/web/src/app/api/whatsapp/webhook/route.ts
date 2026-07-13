import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookSignature, webhookVerifyToken } from "@/lib/whatsapp";

// Meta WhatsApp Cloud API webhook.
//   GET  — one-time verification handshake (echo hub.challenge when the token matches).
//   POST — delivery-status and template-approval callbacks. Signed with the app
//          secret (X-Hub-Signature-256); we verify before trusting anything, then
//          update campaign_recipients / wa_templates via the service role (there
//          is no user session on a Meta callback).
export const dynamic = "force-dynamic";

// Never downgrade a recipient's status — Meta can deliver callbacks out of order.
const RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = webhookVerifyToken();
  if (mode === "subscribe" && expected && token === expected) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  const ok = await verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"));
  if (!ok) return new Response("bad signature", { status: 401 });

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries = ((body as any)?.entry ?? []) as any[];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      // ── delivery statuses ──────────────────────────────────────────────────
      for (const s of value.statuses ?? []) {
        const wamid = s.id as string | undefined;
        const status = s.status as string | undefined; // sent | delivered | read | failed
        if (!wamid || !status) continue;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rows } = await admin.from("campaign_recipients").select("id, status").eq("wa_message_id", wamid).limit(1);
        const row = (rows ?? [])[0] as { id: string; status: string } | undefined;
        if (!row) continue;

        if (status === "failed") {
          const err = (s.errors?.[0]?.title as string) ?? "Delivery failed";
          await admin.from("campaign_recipients").update({ status: "failed", error: err }).eq("id", row.id);
        } else if ((RANK[status] ?? 0) > (RANK[row.status] ?? 0)) {
          await admin.from("campaign_recipients").update({ status }).eq("id", row.id);
        }
      }

      // ── template approval updates ──────────────────────────────────────────
      if (change.field === "message_template_status_update") {
        const name = value.message_template_name as string | undefined;
        const event = value.event as string | undefined; // APPROVED | REJECTED | ...
        const map: Record<string, string> = { APPROVED: "approved", REJECTED: "rejected", PENDING: "pending", FLAGGED: "pending" };
        const status = event ? map[event] : undefined;
        if (name && status) {
          await admin.from("wa_templates").update({ status, reject_reason: status === "rejected" ? (value.reason ?? null) : null }).eq("name", name);
        }
      }
    }
  }

  return new Response("ok", { status: 200 });
}
