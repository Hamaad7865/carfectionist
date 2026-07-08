import { createAdminClient } from "@/lib/supabase/admin";

// Roster for the Android POS login screen: the name tiles staff tap before
// entering their PIN. Gated by a shared device key (not a public endpoint);
// the tablet has no Supabase session yet at this point. Service-role read stays
// server-side. Only active staff who actually have a PIN set are returned.
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function deviceOk(req: Request): boolean {
  const expected = process.env.POS_DEVICE_KEY;
  return !!expected && req.headers.get("x-pos-device-key") === expected;
}

export async function GET(req: Request) {
  if (!deviceOk(req)) return json({ error: "unauthorized" }, 401);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("app_users")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select("id, display_name, role" as any)
    .eq("is_active", true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .not("pin_hash" as any, "is", null)
    .order("display_name");
  if (error) return json({ error: "server_error" }, 500);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roster = ((data ?? []) as any[]).map((u) => ({ appUserId: u.id, displayName: u.display_name, role: u.role }));
  return json({ roster });
}
