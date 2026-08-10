import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionContext } from "@/lib/auth/session";

// The owner's on-the-spot approval, from the cashier's own screen: the owner
// picks their name, types their PIN, and app.record_owner_override — reached
// through the public.record_owner_override door (app is not a PostgREST-
// exposed schema on this project, see 20260810000070) — checks it server-side
// with the same lockout-guarded verify_staff_pin the tablet login uses.
// Nobody is signed out and nobody becomes an owner: this only ever produces a
// row that a LATER rpc (app.assert_discount_allowed, reverse_payment,
// create_and_issue_credit_note) re-reads for itself. This route decides
// nothing about who the owner is — it just carries the PIN to the one
// function that does, and classifies its answer into an HTTP status.
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Whoever can build/issue a document may ASK for an override — the RPC is
// what actually gate-keeps on the PIN and the approver's own role.
const CALLER_ROLES = ["owner", "manager", "cashier"];

interface Caller {
  role: string;
  tenantId: string;
}

/**
 * Who is asking — from EITHER the browser's session cookie or the tablet's Bearer
 * token, same two-transport split as /api/documents/[id]/send. The cookie path is
 * untouched (getSessionContext() reads no header, so trying it first changes nothing
 * for the browser); the Bearer path binds an RLS client to the token, exactly like the
 * tablet's other calls, so the role/tenant read below runs as the signed-in operator,
 * never as the service role.
 */
async function resolveCaller(req: Request): Promise<Caller | null> {
  const session = await getSessionContext();
  if (session) return { role: session.role, tenantId: session.tenantId };

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const sb = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: me } = await sb.auth.getUser(token);
  if (!me?.user) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: appUser } = await (sb as any)
    .from("app_users")
    .select("role, tenant_id")
    .eq("auth_user_id", me.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!appUser) return null;
  return { role: appUser.role as string, tenantId: appUser.tenant_id as string };
}

const UUID_RE = /^[0-9a-f-]{36}$/i;
const PIN_RE = /^[0-9]{4}$/;

interface OverrideRequestBody {
  appUserId?: unknown;
  pin?: unknown;
  kind?: unknown;
  refType?: unknown;
  refId?: unknown;
  reason?: unknown;
  maxDiscountCents?: unknown;
}

export async function POST(req: Request) {
  const caller = await resolveCaller(req);
  if (!caller) return json({ error: "unauthorized" }, 401);
  if (!CALLER_ROLES.includes(caller.role)) return json({ error: "forbidden" }, 403);

  let body: OverrideRequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const appUserId = typeof body.appUserId === "string" ? body.appUserId : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  const kind = body.kind === "discount" || body.kind === "reversal" ? body.kind : null;
  const refType = body.refType === "document" || body.refType === "payment" ? body.refType : null;
  const refId = typeof body.refId === "string" ? body.refId : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!UUID_RE.test(appUserId)) return json({ error: "bad_request" }, 400);
  if (!PIN_RE.test(pin)) return json({ error: "bad_request" }, 400);
  if (!kind) return json({ error: "bad_request" }, 400);
  if (!refType) return json({ error: "bad_request" }, 400);
  if (!UUID_RE.test(refId)) return json({ error: "bad_request" }, 400);
  if (!reason) return json({ error: "bad_request" }, 400);

  // owner_overrides.scope is read back in RUPEES by app.assert_discount_allowed
  // (scope->>'max_discount_incl'), but every money value that reaches this
  // route from the browser is CENTS, same as everywhere else in this app.
  // Get this ÷100 backwards (or drop it) and an owner's "up to Rs 500" turns
  // into "up to Rs 50,000" the next time the ceiling is checked. `discount`
  // is the only kind that carries a figure — a reversal override is a single-
  // use yes/no, consumed by app.require_owner_or_override, not a ceiling.
  let scope: Record<string, number> = {};
  if (kind === "discount") {
    const raw = body.maxDiscountCents;
    if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) {
      return json({ error: "bad_request" }, 400);
    }
    scope = { max_discount_incl: raw / 100 };
  }

  const admin = createAdminClient();

  // Defence in depth: app.record_owner_override is service-role-only and has
  // no notion of "the caller's tenant" — it trusts whoever holds the service
  // key to have already scoped appUserId sensibly. The dialog only ever offers
  // owners from the caller's own tenant (RLS-scoped app_users read), so this
  // only bites a hand-crafted request — but without it, any known app_user_id
  // from ANY tenant would still reach verify_staff_pin's lockout counter,
  // turning this route into a cross-tenant PIN-guessing dial.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: target } = await (admin as any)
    .from("app_users")
    .select("tenant_id")
    .eq("id", appUserId)
    .maybeSingle();
  if (!target || target.tenant_id !== caller.tenantId) return json({ error: "not_owner" }, 401);

  // The PIN is checked HERE FIRST, in its own round trip, and that is not
  // belt-and-braces — it is the only thing that makes the lockout work.
  //
  // record_owner_override verifies the PIN too, but it RAISES on a bad one, and
  // a plpgsql exception rolls back the whole call — including the attempt-counter
  // UPDATE that verify_staff_pin had just made inside it. Measured: after a wrong
  // PIN through that path, pin_attempts was still 0. A 4-digit secret with a
  // silently-reverted lockout is a 10,000-guess dial, which would have undone the
  // point of rule 3.
  //
  // A separate call is a separate transaction, so the increment commits. The RPC
  // still verifies for itself afterwards — it must never trust a caller's word on
  // the PIN, service key or not.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pinCheck, error: pinErr } = await (admin as any).rpc("verify_staff_pin", {
    p_app_user_id: appUserId,
    p_pin: pin,
  });
  if (pinErr) return json({ error: "server_error" }, 500);
  if (!pinCheck?.ok) {
    return json({ error: "pin_rejected", reason: pinCheck?.reason ?? "invalid" }, 401);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any).rpc("record_owner_override", {
    p_app_user_id: appUserId,
    p_pin: pin,
    p_kind: kind,
    p_ref_type: refType,
    p_ref_id: refId,
    p_reason: reason,
    p_scope: scope,
  });

  if (error) {
    const msg = String(error.message ?? "");
    // A wrong/locked PIN, or "this account can't approve", is the caller's
    // problem, not ours — the owner just needs to try again, or the dialog
    // needs to hand the device to an actual owner. Never echo the PIN, the raw
    // Postgres text, or anything service-key-shaped back to the browser.
    const pinMatch = /owner PIN rejected \(([^)]*)\)/i.exec(msg);
    if (pinMatch) return json({ error: "pin_rejected", reason: pinMatch[1] || "invalid" }, 401);
    if (/only the owner can approve|unknown approver/i.test(msg)) return json({ error: "not_owner" }, 401);
    if (/requires a reason/i.test(msg)) return json({ error: "bad_request" }, 400);
    return json({ error: "server_error" }, 500);
  }

  // A REJECTED PIN COMES BACK HERE, NOT IN `error`. record_owner_override
  // answers {ok:false, reason} rather than raising, because raising would roll
  // back the attempt counter verify_staff_pin had just incremented and hand the
  // guesser a free try (see 20260810000080). So the soft answer has to be
  // classified — without this, a refusal falls through and is reported to the
  // cashier as an approval, which is the worst possible direction to fail in.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (Array.isArray(data) ? data[0] : data) as any;
  if (!result?.ok) {
    return json({ error: "pin_rejected", reason: result?.reason ?? "invalid" }, 401);
  }

  const row = result.override ?? {};
  return json({
    override: {
      id: row.id,
      kind: row.kind,
      refType: row.ref_type,
      refId: row.ref_id,
      createdAt: row.created_at,
    },
  });
}
