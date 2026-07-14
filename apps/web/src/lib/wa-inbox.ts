import type { SupabaseClient } from "@supabase/supabase-js";
import * as wa from "@/lib/whatsapp";

// Server-side inbox plumbing shared by the webhook (inbound) and the send paths
// (outbound), so every message — a customer's reply, a quote we sent, a campaign
// blast — lands in ONE thread per phone number.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Find-or-create the conversation for a phone number, matching a customer when
 *  we know one. Returns the conversation id. */
export async function upsertConversation(
  admin: SupabaseClient<any>,
  tenantId: string,
  phone: string,
  opts: { waName?: string | null; customerId?: string | null } = {},
): Promise<string | null> {
  const { data: existing } = await admin
    .from("wa_conversations")
    .select("id, customer_id, wa_name")
    .eq("tenant_id", tenantId)
    .eq("phone_e164", phone)
    .maybeSingle();

  if (existing) {
    // Backfill a customer match / profile name we didn't have before.
    const patch: Record<string, unknown> = {};
    if (!existing.customer_id && opts.customerId) patch.customer_id = opts.customerId;
    if (!existing.wa_name && opts.waName) patch.wa_name = opts.waName;
    if (Object.keys(patch).length) await admin.from("wa_conversations").update(patch).eq("id", existing.id);
    return existing.id as string;
  }

  // Unknown number → try to match a customer by their stored phone.
  let customerId = opts.customerId ?? null;
  if (!customerId) {
    const { data: cust } = await admin.from("customers").select("id, phone").eq("tenant_id", tenantId).not("phone", "is", null);
    const { normalizePhoneMU } = await import("@/lib/phone");
    customerId = ((cust ?? []) as any[]).find((c) => normalizePhoneMU(c.phone) === phone)?.id ?? null;
  }

  const { data: created } = await admin
    .from("wa_conversations")
    .insert({ tenant_id: tenantId, phone_e164: phone, customer_id: customerId, wa_name: opts.waName ?? null })
    .select("id")
    .single();
  return (created?.id as string) ?? null;
}

/** Record a message WE sent (document, campaign, or a typed reply) into its
 *  thread, so the conversation reads as one story. Best-effort: a failure here
 *  must never fail the send itself. */
export async function recordOutbound(
  admin: SupabaseClient<any>,
  i: {
    tenantId: string;
    phone: string;
    body: string;
    waMessageId?: string | null;
    msgType?: "text" | "template" | "document";
    refType?: "document" | "campaign" | null;
    refId?: string | null;
    sentBy?: string | null;
    customerId?: string | null;
  },
): Promise<void> {
  try {
    const convId = await upsertConversation(admin, i.tenantId, i.phone, { customerId: i.customerId ?? null });
    if (!convId) return;
    await admin.from("wa_messages").insert({
      tenant_id: i.tenantId,
      conversation_id: convId,
      direction: "out",
      wa_message_id: i.waMessageId ?? null,
      msg_type: i.msgType ?? "text",
      body: i.body,
      status: "sent",
      ref_type: i.refType ?? null,
      ref_id: i.refId ?? null,
      sent_by: i.sentBy ?? null,
    });
    await admin.from("wa_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);
  } catch {
    /* threading is a convenience — never break a real send over it */
  }
}

/** Pull an inbound media attachment from Meta into our private bucket.
 *  Returns the storage path, or null if anything went wrong (the message still
 *  lands, just without the file). */
export async function storeInboundMedia(
  admin: SupabaseClient<any>,
  tenantId: string,
  mediaId: string,
): Promise<{ path: string; mime: string } | null> {
  const meta = await wa.fetchMediaMeta(mediaId);
  if (!meta.ok) return null;
  const dl = await wa.downloadMedia(meta.data.url);
  if (!dl.ok) return null;

  const ext = meta.data.mime.split("/")[1]?.split(";")[0] ?? "bin";
  const path = `${tenantId}/wa/${mediaId}.${ext}`;
  const { error } = await admin.storage
    .from("wa-media")
    .upload(path, dl.data.bytes, { contentType: meta.data.mime, upsert: true });
  if (error) return null;
  return { path, mime: meta.data.mime };
}

/** One inbound Meta message → a row in its thread (media fetched, unread bumped). */
export async function ingestInbound(
  admin: SupabaseClient<any>,
  tenantId: string,
  msg: any,
  profileName: string | null,
): Promise<void> {
  const phone = String(msg.from ?? "");
  if (!phone) return;
  const convId = await upsertConversation(admin, tenantId, phone, { waName: profileName });
  if (!convId) return;

  const type = String(msg.type ?? "text");
  let body: string | null = null;
  let mediaPath: string | null = null;
  let mediaMime: string | null = null;
  let mediaName: string | null = null;
  let msgType = "text";

  switch (type) {
    case "text":
      body = msg.text?.body ?? "";
      break;
    case "image":
    case "document":
    case "audio":
    case "video":
    case "sticker": {
      msgType = type;
      body = msg[type]?.caption ?? null;
      mediaName = msg[type]?.filename ?? null;
      const mediaId = msg[type]?.id;
      if (mediaId) {
        const stored = await storeInboundMedia(admin, tenantId, String(mediaId));
        if (stored) {
          mediaPath = stored.path;
          mediaMime = stored.mime;
        }
      }
      break;
    }
    case "location":
      msgType = "location";
      body = `📍 ${msg.location?.name ?? ""} ${msg.location?.latitude},${msg.location?.longitude}`.trim();
      break;
    case "button":
    case "interactive":
      body = msg.button?.text ?? msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? "(reply)";
      break;
    default:
      msgType = "unsupported";
      body = `(${type} message — open WhatsApp to view)`;
  }

  const { error } = await admin.from("wa_messages").insert({
    tenant_id: tenantId,
    conversation_id: convId,
    direction: "in",
    wa_message_id: msg.id ?? null,
    msg_type: msgType,
    body,
    media_path: mediaPath,
    media_mime: mediaMime,
    media_name: mediaName,
    status: "received",
  });
  // A duplicate wamid = Meta re-delivering the same webhook; ignore it silently.
  if (error && !/duplicate key/i.test(error.message)) return;
  if (error) return;

  const now = new Date().toISOString();
  const { data: conv } = await admin.from("wa_conversations").select("unread").eq("id", convId).maybeSingle();
  await admin
    .from("wa_conversations")
    .update({ last_message_at: now, last_inbound_at: now, unread: Number(conv?.unread ?? 0) + 1, archived: false })
    .eq("id", convId);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
