import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { sendDocument } from "@/lib/send-document";

// Tablet entry point for "Send to customer": the POS calls this with the
// operator's Supabase access token as a Bearer header. We bind an RLS client
// to that token, so document access and the audit insert run as the operator —
// same trust model as the web server actions, different transport.
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

  // Role gate — mirror the web action (sendDocumentAction requires owner/manager/
  // cashier). RLS lets any tenant member READ documents, so without this a
  // technician could POST here to exfiltrate any PDF and overwrite contacts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: appUser } = await (sb as any).from("app_users").select("role").eq("auth_user_id", me.user.id).eq("is_active", true).maybeSingle();
  const role = appUser?.role as string | undefined;
  if (!role || !["owner", "manager", "cashier"].includes(role)) return json({ ok: false, error: "forbidden" }, 403);

  let body: { channel?: string; to?: string; note?: string; saveContact?: boolean; deviceCode?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad request" }, 400);
  }
  if (body.channel !== "email" && body.channel !== "whatsapp") return json({ ok: false, error: "bad channel" }, 400);
  if (typeof body.to !== "string") return json({ ok: false, error: "missing recipient" }, 400);

  const host = req.headers.get("host") ?? "app-carfectionist.com";
  const proto = host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("10.0.2.2") ? "http" : "https";
  const origin = `${proto}://${host}`;
  const r = await sendDocument({
    sb,
    docId: id,
    channel: body.channel,
    to: body.to,
    note: typeof body.note === "string" ? body.note : null,
    saveContact: !!body.saveContact,
    origin,
    deviceCode: typeof body.deviceCode === "string" ? body.deviceCode : null,
  });
  return json(r, r.ok ? 200 : 422);
}
