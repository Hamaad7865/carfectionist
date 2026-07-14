import { createClient } from "@/lib/supabase/server";
import { muDateTime } from "@/lib/mu-date";
import { formatPhone } from "@/lib/phone";

// ─── WhatsApp inbox ──────────────────────────────────────────────────────────
// One thread per customer phone number. Meta's 24-hour rule: a free-typed reply
// is only allowed within 24h of the customer's LAST inbound message — after that
// only an approved template may go out. windowClosesAt drives that in the UI.

const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ConversationRow {
  id: string;
  phone: string;          // pretty +230 5258 8854
  phoneRaw: string;       // 23052588854
  name: string;           // customer name, else WhatsApp profile name, else the number
  customerId: string | null;
  lastAt: string;
  lastPreview: string;
  unread: number;
  windowOpen: boolean;
  minutesLeft: number | null; // of the 24h reply window
}

export interface ThreadMessage {
  id: string;
  direction: "in" | "out";
  type: string;
  body: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  status: string;
  error: string | null;
  at: string;
  atIso: string;
  byName: string | null;
  refType: string | null;
  refId: string | null;
}

export interface ThreadDetail {
  id: string;
  phoneRaw: string;
  phone: string;
  name: string;
  customerId: string | null;
  customerName: string | null;
  vehicles: string[];
  openJobId: string | null;
  windowOpen: boolean;
  minutesLeft: number | null;
  messages: ThreadMessage[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function windowState(lastInboundAt: string | null): { open: boolean; minutesLeft: number | null } {
  if (!lastInboundAt) return { open: false, minutesLeft: null };
  const left = Date.parse(lastInboundAt) + WINDOW_MS - Date.now();
  return { open: left > 0, minutesLeft: left > 0 ? Math.floor(left / 60000) : null };
}

export async function getConversations(): Promise<{ rows: ConversationRow[]; unreadTotal: number }> {
  const sb = await createClient();
  const { data } = await sb
    .from("wa_conversations")
    .select("id, phone_e164, wa_name, customer_id, last_message_at, last_inbound_at, unread, customers(name)")
    .eq("archived", false)
    .order("last_message_at", { ascending: false })
    .limit(100);

  const convs = (data ?? []) as any[];
  if (convs.length === 0) return { rows: [], unreadTotal: 0 };

  // Last message of each thread, for the preview line.
  const { data: msgs } = await sb
    .from("wa_messages")
    .select("conversation_id, direction, body, msg_type, created_at")
    .in("conversation_id", convs.map((c) => c.id))
    .order("created_at", { ascending: false })
    .limit(400);

  const lastByConv = new Map<string, any>();
  for (const m of (msgs ?? []) as any[]) if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, m);

  const rows: ConversationRow[] = convs.map((c) => {
    const last = lastByConv.get(c.id);
    const w = windowState(c.last_inbound_at);
    const preview = last
      ? `${last.direction === "out" ? "You: " : ""}${last.body ?? (last.msg_type === "image" ? "📷 Photo" : last.msg_type === "document" ? "📄 Document" : `(${last.msg_type})`)}`
      : "—";
    return {
      id: c.id,
      phoneRaw: c.phone_e164,
      phone: formatPhone(c.phone_e164),
      name: c.customers?.name ?? c.wa_name ?? formatPhone(c.phone_e164),
      customerId: c.customer_id ?? null,
      lastAt: muDateTime(c.last_message_at),
      lastPreview: preview.slice(0, 90),
      unread: Number(c.unread ?? 0),
      windowOpen: w.open,
      minutesLeft: w.minutesLeft,
    };
  });

  return { rows, unreadTotal: rows.reduce((s, r) => s + r.unread, 0) };
}

/** Unread badge for the sidebar — cheap, no message join. */
export async function getUnreadCount(): Promise<number> {
  const sb = await createClient();
  const { data } = await sb.from("wa_conversations").select("unread").eq("archived", false);
  return ((data ?? []) as any[]).reduce((s, c) => s + Number(c.unread ?? 0), 0);
}

export async function getThread(id: string): Promise<ThreadDetail | null> {
  const sb = await createClient();
  const { data: conv } = await sb
    .from("wa_conversations")
    .select("id, phone_e164, wa_name, customer_id, last_inbound_at, customers(name)")
    .eq("id", id)
    .maybeSingle();
  if (!conv) return null;
  const c = conv as any;

  const [{ data: msgs }, { data: users }] = await Promise.all([
    sb.from("wa_messages")
      .select("id, direction, msg_type, body, media_path, media_mime, media_name, status, error, created_at, sent_by, ref_type, ref_id")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(300),
    sb.from("app_users").select("id, display_name"),
  ]);

  const nameById = new Map(((users ?? []) as any[]).map((u) => [u.id, String(u.display_name ?? "").replace(/\s*\(.*\)\s*$/, "").trim()]));

  // Signed URLs for any media in the thread (private bucket).
  const paths = ((msgs ?? []) as any[]).map((m) => m.media_path).filter(Boolean) as string[];
  const urlByPath = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await sb.storage.from("wa-media").createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }

  const messages: ThreadMessage[] = ((msgs ?? []) as any[]).map((m) => ({
    id: m.id,
    direction: m.direction,
    type: m.msg_type,
    body: m.body,
    mediaUrl: m.media_path ? urlByPath.get(m.media_path) ?? null : null,
    mediaMime: m.media_mime ?? null,
    mediaName: m.media_name ?? null,
    status: m.status,
    error: m.error ?? null,
    at: muDateTime(m.created_at),
    atIso: m.created_at,
    byName: m.sent_by ? nameById.get(m.sent_by) ?? null : null,
    refType: m.ref_type ?? null,
    refId: m.ref_id ?? null,
  }));

  // Context that makes a reply informed: their car(s) and any live job.
  let vehicles: string[] = [];
  let openJobId: string | null = null;
  if (c.customer_id) {
    const [{ data: vehs }, { data: jobs }] = await Promise.all([
      sb.from("vehicles").select("plate, make, model").eq("customer_id", c.customer_id).limit(5),
      sb.from("jobs").select("id, status").eq("customer_id", c.customer_id).neq("status", "delivered").neq("status", "cancelled").order("created_at", { ascending: false }).limit(1),
    ]);
    vehicles = ((vehs ?? []) as any[]).map((v) => [v.plate, [v.make, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" · "));
    openJobId = ((jobs ?? []) as any[])[0]?.id ?? null;
  }

  const w = windowState(c.last_inbound_at);
  return {
    id: c.id,
    phoneRaw: c.phone_e164,
    phone: formatPhone(c.phone_e164),
    name: c.customers?.name ?? c.wa_name ?? formatPhone(c.phone_e164),
    customerId: c.customer_id ?? null,
    customerName: c.customers?.name ?? null,
    vehicles,
    openJobId,
    windowOpen: w.open,
    minutesLeft: w.minutesLeft,
    messages,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
