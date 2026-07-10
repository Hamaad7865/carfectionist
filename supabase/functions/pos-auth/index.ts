// Staff-PIN auth for the Android POS, served from Supabase's own edge — the tablet
// talks only to <project>.supabase.co, no web deployment or dev PC in the path.
// A 1:1 port of the web app's /api/pos/roster and /api/pos/pin-login routes:
// the shared device key gates both, the PIN is verified server-side by the
// verify_staff_pin RPC (with its DB lockout), and the operator's session is
// minted with a one-time magic-link token that is immediately redeemed. Neither
// the service-role key nor any password ever reaches the tablet.
//
// Deployed with --no-verify-jwt: callers have no session yet — the device key
// is the gate, exactly as it was on the web routes.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEVICE_KEY = Deno.env.get("POS_DEVICE_KEY") ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function deviceOk(req: Request): boolean {
  return !!DEVICE_KEY && req.headers.get("x-pos-device-key") === DEVICE_KEY;
}

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function roster(): Promise<Response> {
  const { data, error } = await admin()
    .from("app_users")
    .select("id, display_name, role")
    .eq("is_active", true)
    .not("pin_hash", "is", null)
    .order("display_name");
  if (error) return json({ error: "server_error" }, 500);
  const out = (data ?? []).map((u) => ({ appUserId: u.id, displayName: u.display_name, role: u.role }));
  return json({ roster: out });
}

async function pinLogin(req: Request): Promise<Response> {
  let body: { appUserId?: unknown; pin?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const appUserId = String(body?.appUserId ?? "");
  const pin = String(body?.pin ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(appUserId) || !/^[0-9]{4}$/.test(pin)) return json({ error: "bad_request" }, 400);

  const svc = admin();

  // 1) verify the PIN (server-side, with per-user lockout)
  const { data: v, error: vErr } = await svc.rpc("verify_staff_pin", { p_app_user_id: appUserId, p_pin: pin });
  if (vErr) return json({ error: "server_error" }, 500);
  if (!v?.ok) return json({ error: v?.reason ?? "invalid", lockedUntil: v?.locked_until ?? null }, 401);

  // 2) the operator's email, needed to mint a session
  const { data: userRes, error: uErr } = await svc.auth.admin.getUserById(v.auth_user_id as string);
  const email = userRes?.user?.email;
  if (uErr || !email) return json({ error: "server_error" }, 500);

  // 3) mint a session without the password: one-time magic-link token…
  const { data: linkData, error: lErr } = await svc.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = (linkData as { properties?: { hashed_token?: string } })?.properties?.hashed_token;
  if (lErr || !tokenHash) return json({ error: "server_error" }, 500);

  // …immediately redeemed with an anon client for the session tokens.
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: otp, error: oErr } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  const session = otp?.session;
  if (oErr || !session) return json({ error: "server_error" }, 500);

  return json({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
    operator: { appUserId, displayName: v.display_name, role: v.role },
  });
}

Deno.serve(async (req) => {
  if (!deviceOk(req)) return json({ error: "unauthorized" }, 401);
  const path = new URL(req.url).pathname;
  if (req.method === "GET" && path.endsWith("/roster")) return await roster();
  if (req.method === "POST" && path.endsWith("/pin-login")) return await pinLogin(req);
  return json({ error: "not_found" }, 404);
});
