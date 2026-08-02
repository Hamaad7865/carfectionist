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

// ── the device verifier ───────────────────────────────────────────────────────
// PBKDF2-HMAC-SHA256 of the PIN, minted server-side and handed to the tills via
// the roster, so ANY tablet that has synced once can verify ANY staff member's
// PIN with no network. Deliberately not the bcrypt pin_hash (which never leaves
// the server) and deliberately slow: 310k iterations makes each offline guess
// cost real time on tablet hardware. Format and parameters are mirrored by the
// Android PinHasher and the web team action — the three must stay in lockstep.
const VERIFIER_ITERATIONS = 310_000;

async function pbkdf2(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function mintVerifier(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const dk = await pbkdf2(pin, salt, VERIFIER_ITERATIONS);
  return `pbkdf2:sha256:${VERIFIER_ITERATIONS}:${b64(salt)}:${b64(dk)}`;
}

/** Does the stored verifier match this (known-correct) PIN? Malformed = no. */
async function verifierMatches(pin: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split(":");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  try {
    const dk = await pbkdf2(pin, unb64(parts[3]), iterations);
    const expected = unb64(parts[4]);
    if (dk.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < dk.length; i++) diff |= dk[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

async function roster(): Promise<Response> {
  const { data, error } = await admin()
    .from("app_users")
    .select("id, display_name, role, pin_device_verifier")
    .eq("is_active", true)
    .not("pin_hash", "is", null)
    .order("display_name");
  if (error) return json({ error: "server_error" }, 500);
  const out = (data ?? []).map((u) => ({
    appUserId: u.id,
    displayName: u.display_name,
    role: u.role,
    // The tills' offline gate. Null for staff whose PIN has neither been set with
    // a verifier nor used for an online sign-in since verifiers existed.
    verifier: u.pin_device_verifier ?? null,
  }));
  return json({ roster: out });
}

async function pinLogin(req: Request): Promise<Response> {
  let body: { appUserId?: unknown; pin?: unknown; deviceCode?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const appUserId = String(body?.appUserId ?? "");
  const pin = String(body?.pin ?? "");
  // Optional device code (TAB-xxxx) — stamps the sign-in for per-device traceability.
  const deviceCode = typeof body?.deviceCode === "string" && /^[\w-]{1,64}$/.test(body.deviceCode) ? body.deviceCode : null;
  if (!/^[0-9a-f-]{36}$/i.test(appUserId) || !/^[0-9]{4}$/.test(pin)) return json({ error: "bad_request" }, 400);

  const svc = admin();

  // 1) verify the PIN (server-side, with per-user lockout)
  const { data: v, error: vErr } = await svc.rpc("verify_staff_pin", { p_app_user_id: appUserId, p_pin: pin });
  if (vErr) return json({ error: "server_error" }, 500);
  if (!v?.ok) return json({ error: v?.reason ?? "invalid", lockedUntil: v?.locked_until ?? null }, 401);

  // 1b) the PIN is proven correct and briefly in hand — make sure its device
  // verifier exists and matches, so every till's roster can admit this person
  // offline. Backfills staff whose PIN predates verifiers, and refreshes after
  // a PIN change. Best-effort: sign-in must never fail on it.
  try {
    const { data: au } = await svc.from("app_users").select("pin_device_verifier").eq("id", appUserId).maybeSingle();
    const stored = (au as { pin_device_verifier?: string | null } | null)?.pin_device_verifier ?? null;
    if (!(await verifierMatches(pin, stored))) {
      await svc.from("app_users").update({ pin_device_verifier: await mintVerifier(pin) }).eq("id", appUserId);
    }
  } catch { /* the roster just serves it a little later */ }

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

  // Record the POS sign-in for the Activity log (best-effort, mirrors the web route).
  try {
    const { data: au } = await svc.from("app_users").select("tenant_id").eq("id", appUserId).maybeSingle();
    const tenantId = (au as { tenant_id?: string } | null)?.tenant_id;
    if (tenantId) {
      await svc.from("audit_events").insert({
        tenant_id: tenantId, actor_id: appUserId, event_type: "signed_in",
        ref_type: "app_user", ref_id: appUserId, payload: { device: "pos" },
        device_id: deviceCode,
      });
    }
  } catch { /* never let audit failure break the sign-in */ }

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
