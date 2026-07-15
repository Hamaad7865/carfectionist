// WhatsApp Business Cloud API client (Meta Graph v21.0). Thin fetch wrapper,
// workerd-safe (Web Crypto for the webhook signature, no Node bits). Reads
// config from env — until the owner completes Meta setup and the secrets are
// deployed, isConfigured() is false and every caller returns a clear
// "not connected yet" message (same shape as lib/email.ts).
//
// Marketing on WhatsApp = pre-approved TEMPLATE messages. We submit a template
// to Meta (submitTemplate), poll approval (fetchTemplateStatuses), then send
// the approved template per recipient with positional variables (sendTemplate).

import { serverEnv } from "@/lib/server-env";

const GRAPH = "https://graph.facebook.com/v21.0";

interface WaEnv {
  token: string;
  phoneNumberId: string;
  wabaId: string;
  appSecret: string;
  verifyToken: string;
}

// Secrets resolve via serverEnv (Cloudflare context on the Worker, process.env
// in dev/tests). Kept behind a getter so a missing value is a runtime
// "not configured" rather than an import-time crash.
function waEnv(): Partial<WaEnv> {
  return {
    token: serverEnv("WHATSAPP_TOKEN"),
    phoneNumberId: serverEnv("WHATSAPP_PHONE_NUMBER_ID"),
    wabaId: serverEnv("WHATSAPP_WABA_ID"),
    appSecret: serverEnv("WHATSAPP_APP_SECRET"),
    verifyToken: serverEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
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
// example for each variable so reviewers see representative text. An optional
// DOCUMENT header lets the sent message carry a PDF (quotes/invoices).
export function buildTemplatePayload(t: {
  name: string;
  language: string;
  category: string;
  body: string;
  variableExamples: string[];
  headerFormat?: "DOCUMENT";
}) {
  const components: Record<string, unknown>[] = [];
  if (t.headerFormat) components.push({ type: "HEADER", format: t.headerFormat });
  const body: Record<string, unknown> = { type: "BODY", text: t.body };
  if (t.variableExamples.length > 0) body.example = { body_text: [t.variableExamples] };
  components.push(body);
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

/** Template send carrying a PDF in the DOCUMENT header (Meta fetches the link). */
export function buildDocumentSendPayload(
  phone: string,
  templateName: string,
  language: string,
  vars: string[],
  doc: { link: string; filename: string },
) {
  const components: Record<string, unknown>[] = [
    { type: "header", parameters: [{ type: "document", document: { link: doc.link, filename: doc.filename } }] },
  ];
  if (vars.length > 0) components.push({ type: "body", parameters: vars.map((v) => ({ type: "text", text: v })) });
  return {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: { name: templateName, language: { code: language }, components },
  };
}

/** Send one approved document-header template (quote/invoice PDF). */
export async function sendDocumentTemplate(
  phone: string,
  templateName: string,
  language: string,
  vars: string[],
  doc: { link: string; filename: string },
): Promise<WaResult<{ messageId: string }>> {
  const e = waEnv();
  if (!e.token || !e.phoneNumberId) return { ok: false, error: NOT_CONFIGURED };
  const r = await graph(
    `${e.phoneNumberId}/messages`,
    { method: "POST", body: JSON.stringify(buildDocumentSendPayload(phone, templateName, language, vars, doc)) },
    e.token,
  );
  if (!r.ok) return r;
  const messages = (r.data.messages as { id?: string }[] | undefined) ?? [];
  return { ok: true, data: { messageId: messages[0]?.id ?? "" } };
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
  headerFormat?: "DOCUMENT";
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

// ─── two-way messaging (the reply inbox) ─────────────────────────────────────

/** Free-typed reply. Meta ONLY allows this inside the 24h service window (i.e.
 *  within 24h of the customer's last inbound message); outside it the Graph API
 *  rejects with #131047 and an approved template must be used instead. */
export async function sendText(phone: string, body: string): Promise<WaResult<{ messageId: string }>> {
  const e = waEnv();
  if (!e.token || !e.phoneNumberId) return { ok: false, error: NOT_CONFIGURED };
  const r = await graph(
    `${e.phoneNumberId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "text",
        text: { preview_url: true, body },
      }),
    },
    e.token,
  );
  if (!r.ok) {
    // Translate the one error the operator will actually hit into plain words.
    if (/131047|re-?engagement|outside.*window/i.test(r.error)) {
      return { ok: false, error: "The 24-hour reply window has closed — send an approved template instead." };
    }
    return r;
  }
  const messages = (r.data.messages as { id?: string }[] | undefined) ?? [];
  return { ok: true, data: { messageId: messages[0]?.id ?? "" } };
}

/** Mark an inbound message read (the customer sees the blue ticks). Best-effort. */
export async function markReadOnWhatsApp(wamid: string): Promise<void> {
  const e = waEnv();
  if (!e.token || !e.phoneNumberId) return;
  await graph(
    `${e.phoneNumberId}/messages`,
    { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: wamid }) },
    e.token,
  ).catch(() => undefined);
}

/** Inbound media arrives as an id — resolve it to a (short-lived, token-gated) URL. */
export async function fetchMediaMeta(mediaId: string): Promise<WaResult<{ url: string; mime: string; fileSize: number }>> {
  const e = waEnv();
  if (!e.token) return { ok: false, error: NOT_CONFIGURED };
  const r = await graph(`${mediaId}`, { method: "GET" }, e.token);
  if (!r.ok) return r;
  return {
    ok: true,
    data: {
      url: String(r.data.url ?? ""),
      mime: String(r.data.mime_type ?? "application/octet-stream"),
      fileSize: Number(r.data.file_size ?? 0),
    },
  };
}

/** Download the bytes of a media URL from step 1 (needs the bearer token too). */
export async function downloadMedia(url: string): Promise<WaResult<{ bytes: ArrayBuffer }>> {
  const e = waEnv();
  if (!e.token) return { ok: false, error: NOT_CONFIGURED };
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${e.token}` } });
    if (!res.ok) return { ok: false, error: `media download ${res.status}` };
    return { ok: true, data: { bytes: await res.arrayBuffer() } };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── connection diagnostics (Settings → WhatsApp) ────────────────────────────
// Proves each credential ACTUALLY works by asking Meta, rather than just
// checking a value is present. Never returns secret values — only what's true.

export interface WaSecretState {
  token: boolean;
  phoneNumberId: boolean;
  wabaId: boolean;
  appSecret: boolean;
  verifyToken: boolean;
}

export function secretState(): WaSecretState {
  const e = waEnv();
  return {
    token: !!e.token,
    phoneNumberId: !!e.phoneNumberId,
    wabaId: !!e.wabaId,
    appSecret: !!e.appSecret,
    verifyToken: !!e.verifyToken,
  };
}

export interface WaProbe {
  phone: { ok: boolean; number?: string; name?: string; quality?: string; error?: string };
  waba: { ok: boolean; name?: string; error?: string };
}

/** Ask Meta who we are. A green result means the token + ids genuinely work. */
export async function probeConnection(): Promise<WaProbe> {
  const e = waEnv();
  const out: WaProbe = { phone: { ok: false }, waba: { ok: false } };
  if (!e.token) {
    out.phone.error = "No access token set.";
    out.waba.error = "No access token set.";
    return out;
  }

  if (e.phoneNumberId) {
    const r = await graph(`${e.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, { method: "GET" }, e.token);
    if (r.ok) {
      out.phone = {
        ok: true,
        number: String(r.data.display_phone_number ?? ""),
        name: String(r.data.verified_name ?? ""),
        quality: String(r.data.quality_rating ?? ""),
      };
    } else out.phone.error = r.error;
  } else out.phone.error = "No phone number ID set.";

  if (e.wabaId) {
    const r = await graph(`${e.wabaId}?fields=name`, { method: "GET" }, e.token);
    if (r.ok) out.waba = { ok: true, name: String(r.data.name ?? "") };
    else out.waba.error = r.error;
  } else out.waba.error = "No WhatsApp account ID set.";

  return out;
}

/** Meta pre-approves a `hello_world` template on every new account — the
 *  canonical "does sending work end-to-end" test, same as Meta's own console. */
export async function sendHelloWorld(phone: string): Promise<WaResult<{ messageId: string }>> {
  return sendTemplate(phone, "hello_world", "en_US", []);
}
