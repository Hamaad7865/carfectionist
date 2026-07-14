"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/session";
import * as wa from "@/lib/whatsapp";

const ROLES = ["owner", "manager", "cashier"] as const;
type Result = { ok: true } | { ok: false; error: string };

/** Type a reply. Meta only permits free text inside the 24h service window; the
 *  UI hides the box when it's closed, and the API's own rejection is translated
 *  into plain words if the window lapses between render and send. */
const replySchema = z.object({ conversationId: z.string().min(1), body: z.string().min(1).max(4000) });

export async function sendReplyAction(input: z.infer<typeof replySchema>): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const p = replySchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Type a message first." };
  if (!wa.isConfigured()) return { ok: false, error: "WhatsApp isn't connected yet." };

  const sb = await createClient();
  const { data: conv } = await sb
    .from("wa_conversations")
    .select("id, tenant_id, phone_e164, last_inbound_at, customer_id")
    .eq("id", p.data.conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, error: "Conversation not found." };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = conv as any;

  const r = await wa.sendText(c.phone_e164, p.data.body.trim());
  if (!r.ok) return r;

  // Thread our own message + surface the operator's name on it.
  const { data: me } = await sb.auth.getUser();
  const { data: appUser } = me?.user
    ? await sb.from("app_users").select("id").eq("auth_user_id", me.user.id).maybeSingle()
    : { data: null };

  await sb.from("wa_messages").insert({
    tenant_id: c.tenant_id,
    conversation_id: c.id,
    direction: "out",
    wa_message_id: r.data.messageId || null,
    msg_type: "text",
    body: p.data.body.trim(),
    status: "sent",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sent_by: (appUser as any)?.id ?? null,
  });
  await sb.from("wa_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", c.id);

  await sb.from("audit_events").insert({
    tenant_id: c.tenant_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actor_id: (appUser as any)?.id ?? null,
    event_type: "wa_reply_sent",
    ref_type: "customer",
    ref_id: c.customer_id ?? null,
    payload: { to: c.phone_e164, chars: p.data.body.trim().length },
  });

  void ctx;
  revalidatePath("/messages");
  return { ok: true };
}

/** Window closed → the only legal outbound is an approved template. */
const tplSchema = z.object({ conversationId: z.string().min(1), templateId: z.string().min(1) });

export async function sendTemplateReplyAction(input: z.infer<typeof tplSchema>): Promise<Result> {
  await requireRole(...ROLES);
  const p = tplSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Pick a template." };
  if (!wa.isConfigured()) return { ok: false, error: "WhatsApp isn't connected yet." };

  const sb = await createClient();
  const [{ data: conv }, { data: tpl }] = await Promise.all([
    sb.from("wa_conversations").select("id, tenant_id, phone_e164, customer_id, customers(name)").eq("id", p.data.conversationId).maybeSingle(),
    // templates are owner-only under RLS — read them with the service role
    createAdminClient().from("wa_templates").select("id, name, language, body, variable_count, status").eq("id", p.data.templateId).maybeSingle(),
  ]);
  if (!conv) return { ok: false, error: "Conversation not found." };
  if (!tpl) return { ok: false, error: "Template not found." };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const c = conv as any;
  const t = tpl as any;
  if (t.status !== "approved") return { ok: false, error: "That template isn't approved by WhatsApp yet." };

  // Fill any variables with the customer's first name (the only thing we can
  // know generically here) — matches the campaign renderer's first_name source.
  const name = String(c.customers?.name ?? "").trim().split(/\s+/)[0] || "there";
  const vars = Array.from({ length: Number(t.variable_count ?? 0) }, () => name);

  const r = await wa.sendTemplate(c.phone_e164, t.name, t.language, vars);
  if (!r.ok) return r;

  const preview = String(t.body ?? "").replace(/\{\{(\d+)\}\}/g, () => name);
  await sb.from("wa_messages").insert({
    tenant_id: c.tenant_id,
    conversation_id: c.id,
    direction: "out",
    wa_message_id: r.data.messageId || null,
    msg_type: "template",
    body: preview,
    status: "sent",
  });
  await sb.from("wa_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", c.id);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  revalidatePath("/messages");
  return { ok: true };
}

/** Opening a thread clears its unread count (and blue-ticks it on WhatsApp). */
export async function markThreadReadAction(conversationId: string): Promise<Result> {
  await requireRole(...ROLES);
  const sb = await createClient();
  const { data: conv } = await sb.from("wa_conversations").select("id, unread").eq("id", conversationId).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!conv || Number((conv as any).unread ?? 0) === 0) return { ok: true };

  await sb.from("wa_conversations").update({ unread: 0 }).eq("id", conversationId);

  // Blue ticks: mark the newest inbound message read on WhatsApp itself.
  if (wa.isConfigured()) {
    const { data: last } = await sb
      .from("wa_messages")
      .select("wa_message_id")
      .eq("conversation_id", conversationId)
      .eq("direction", "in")
      .not("wa_message_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wamid = (last as any)?.wa_message_id;
    if (wamid) void wa.markReadOnWhatsApp(wamid);
  }

  revalidatePath("/messages");
  return { ok: true };
}

export async function archiveThreadAction(conversationId: string): Promise<Result> {
  await requireRole(...ROLES);
  const sb = await createClient();
  const { error } = await sb.from("wa_conversations").update({ archived: true, unread: 0 }).eq("id", conversationId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/messages");
  return { ok: true };
}
