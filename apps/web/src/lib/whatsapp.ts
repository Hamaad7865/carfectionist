// WhatsApp Business Cloud API client (Meta Graph v21.0). Thin fetch wrapper,
// workerd-safe (Web Crypto for the webhook signature, no Node bits). Reads
// config from env — until the owner completes Meta setup and the secrets are
// deployed, isConfigured() is false and every caller returns a clear
// "not connected yet" message (same shape as lib/email.ts).
//
// Marketing on WhatsApp = pre-approved TEMPLATE messages. We submit a template
// to Meta (submitTemplate), poll approval (fetchTemplateStatuses), then send
// the approved template per recipient with positional variables (sendTemplate).

const GRAPH = "https://graph.facebook.com/v21.0";

interface WaEnv {
  token: string;
  phoneNumberId: string;
  wabaId: string;
  appSecret: string;
  verifyToken: string;
}

// Secrets live in process.env on the Worker (Wrangler secrets), proven by
// lib/receipt-token.ts. Kept behind a getter so a missing value is a runtime
// "not configured" rather than an import-time crash.
function waEnv(): Partial<WaEnv> {
  return {
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    wabaId: process.env.WHATSAPP_WABA_ID,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  };
}

export function isConfigured(): boolean {
  const e = waEnv();
  return Boolean(e.token && e.phoneNumberId && e.wabaId);
}

const NOT_CONFIGURED =
  "WhatsApp isn't connected yet — add the Meta Cloud API credentials (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_WABA_ID) to this deployment.";

export type WaResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ─── template body → Meta components ─────────────────────────────────────────
// Our stored body uses {{1}}, {{2}}… Meta wants a BODY component with an
// example for each variable so reviewers see representative text.
export function buildTemplatePayload(t: {
  name: string;
  language: string;
  category: string;
  body: string;
  variableExamples: string[];
}) {
  const components: Record<string, unknown>[] = [{ type: "BODY", text: t.body }];
  if (t.variableExamples.length > 0) {
    (components[0] as { example?: unknown }).example = { body_text: [t.variableExamples] };
  }
  return { name: t.name, language: t.language, category: t.category, components };
}

/** Positional variables → Meta message "template" payload for one recipient. */
export function buildSendPayload(phone: string, templateName: string, language: string, vars: string[]) {
  const components =
    vars.length > 0
      ? [{ type: "body", parameters: vars.map((v) => ({ type: "text", text: v })) }]
      : [];
  return {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: { name: templateName, language: { code: language }, ...(components.length ? { components } : {}) },
  };
}

async function graph(path: string, init: RequestInit, token: string): Promise<WaResult<Record<string, unknown>>> {
  try {
    const res = await fetch(`${GRAPH}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (json.error as { message?: string; code?: number } | undefined) ?? {};
      return { ok: false, error: err.message ? `${err.message}${err.code ? ` (#${err.code})` : ""}` : `Graph API ${res.status}` };
    }
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Submit a template for Meta approval. Returns the Graph template id. */
export async function submitTemplate(t: {
  name: string;
  language: string;
  category: string;
  body: string;
  variableExamples: string[];
}): Promise<WaResult<{ id: string; status: string }>> {
  const e = waEnv();
  if (!e.token || !e.wabaId) return { ok: false, error: NOT_CONFIGURED };
  const r = await graph(
    `${e.wabaId}/message_templates`,
    { method: "POST", body: JSON.stringify(buildTemplatePayload(t)) },
    e.token,
  );
  if (!r.ok) return r;
  return { ok: true, data: { id: String(r.data.id ?? ""), status: String(r.data.status ?? "PENDING") } };
}

/** Fetch current approval status for the tenant's templates (by name). */
export async function fetchTemplateStatuses(): Promise<WaResult<{ name: string; status: string; id: string; reason: string | null }[]>> {
  const e = waEnv();
  if (!e.token || !e.wabaId) return { ok: false, error: NOT_CONFIGURED };
  const r = await graph(`${e.wabaId}/message_templates?fields=name,status,id&limit=200`, { method: "GET" }, e.token);
  if (!r.ok) return r;
  const data = (r.data.data as Record<string, unknown>[] | undefined) ?? [];
  return {
    ok: true,
    data: data.map((d) => ({
      name: String(d.name ?? ""),
      status: String(d.status ?? ""),
      id: String(d.id ?? ""),
      reason: (d.rejected_reason as string) ?? null,
    })),
  };
}

/** Send one approved template message. Returns the wa_message_id for webhook correlation. */
export async function sendTemplate(
  phone: string,
  templateName: string,
  language: string,
  vars: string[],
): Promise<WaResult<{ messageId: string }>> {
  const e = waEnv();
  if (!e.token || !e.phoneNumberId) return { ok: false, error: NOT_CONFIGURED };
  const r = await graph(
    `${e.phoneNumberId}/messages`,
    { method: "POST", body: JSON.stringify(buildSendPayload(phone, templateName, language, vars)) },
    e.token,
  );
  if (!r.ok) return r;
  const messages = (r.data.messages as { id?: string }[] | undefined) ?? [];
  return { ok: true, data: { messageId: messages[0]?.id ?? "" } };
}

// ─── webhook signature (Meta signs POSTs with X-Hub-Signature-256) ───────────
export async function verifyWebhookSignature(rawBody: string, header: string | null): Promise<boolean> {
  const e = waEnv();
  if (!e.appSecret || !header) return false;
  const expected = header.startsWith("sha256=") ? header.slice(7) : header;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(e.appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time-ish compare (equal length first).
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function webhookVerifyToken(): string | undefined {
  return waEnv().verifyToken;
}
