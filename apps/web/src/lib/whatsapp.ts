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
  headerHandle?: string; // required by Meta for a media header (from uploadHeaderSample)
  urlButton?: { text: string; urlBase: string; exampleSuffix: string }; // dynamic-URL CTA ("View")
}) {
  const components: Record<string, unknown>[] = [];
  if (t.headerFormat) {
    // Meta rejects a media-header template at creation unless it carries an
    // example media handle (error #100/2388043 "HEADER missing example").
    const header: Record<string, unknown> = { type: "HEADER", format: t.headerFormat };
    if (t.headerHandle) header.example = { header_handle: [t.headerHandle] };
    components.push(header);
  }
  const body: Record<string, unknown> = { type: "BODY", text: t.body };
  if (t.variableExamples.length > 0) body.example = { body_text: [t.variableExamples] };
  components.push(body);
  if (t.urlButton) {
    // A template URL button allows ONE variable, and only as a suffix at the
    // very end of the URL — hence the /d/<token> redirect route.
    components.push({
      type: "BUTTONS",
      buttons: [
        {
          type: "URL",
          text: t.urlButton.text,
          url: `${t.urlButton.urlBase}{{1}}`,
          example: [`${t.urlButton.urlBase}${t.urlButton.exampleSuffix}`],
        },
      ],
    });
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

/** Template send carrying a PDF in the DOCUMENT header. Prefer `id` (a media
 *  handle we uploaded ourselves) over `link` (which Meta must fetch — our
 *  Browser-Rendering PDF endpoint cold-starts too slowly and Meta reports
 *  "Media upload error"). */
export function buildDocumentSendPayload(
  phone: string,
  templateName: string,
  language: string,
  vars: string[],
  doc: { link?: string; id?: string; filename: string },
  urlButtonParam?: string, // suffix for the template's dynamic-URL button
) {
  const document = doc.id
    ? { id: doc.id, filename: doc.filename }
    : { link: doc.link, filename: doc.filename };
  const components: Record<string, unknown>[] = [
    { type: "header", parameters: [{ type: "document", document }] },
  ];
  if (vars.length > 0) components.push({ type: "body", parameters: vars.map((v) => ({ type: "text", text: v })) });
  if (urlButtonParam) {
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: urlButtonParam }] });
  }
  return {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: { name: templateName, language: { code: language }, components },
  };
}

/** Upload a document to WhatsApp Cloud and return its media id. A template sent
 *  with a pre-uploaded media id is far more reliable than a link Meta must
 *  fetch: our public PDF endpoint cold-starts a headless Chromium (several
 *  seconds), Meta's media fetch times out, and the customer sees "Media upload
 *  error". We render the PDF once and hand Meta the bytes directly. Media is
 *  bound to the sending phone number and usable in that number's messages. */
export async function uploadMedia(
  bytes: Uint8Array,
  filename: string,
  mime: string,
): Promise<WaResult<string>> {
  const e = waEnv();
  if (!e.token || !e.phoneNumberId) return { ok: false, error: NOT_CONFIGURED };
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mime);
    // slice() gives a tight ArrayBuffer of exactly these bytes for the Blob.
    form.append("file", new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime }), filename);
    // No Content-Type header — fetch sets the multipart boundary itself.
    const res = await fetch(`${GRAPH}/${e.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${e.token}` },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof json.id !== "string") {
      console.error("[wa] media upload failed", JSON.stringify(json.error ?? json));
      const msg = (json.error as { message?: string } | undefined)?.message;
      return { ok: false, error: msg ? `Media upload failed: ${msg}` : "Media upload failed." };
    }
    return { ok: true, data: json.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Send one approved document-header template (quote/invoice PDF). */
export async function sendDocumentTemplate(
  phone: string,
  templateName: string,
  language: string,
  vars: string[],
  doc: { link?: string; id?: string; filename: string },
  urlButtonParam?: string,
): Promise<WaResult<{ messageId: string }>> {
  const e = waEnv();
  if (!e.token || !e.phoneNumberId) return { ok: false, error: NOT_CONFIGURED };
  const r = await graph(
    `${e.phoneNumberId}/messages`,
    { method: "POST", body: JSON.stringify(buildDocumentSendPayload(phone, templateName, language, vars, doc, urlButtonParam)) },
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
      // Meta packs the ACTUAL reason for a #100 into error_data.details — e.g.
      // "the parameter document is not expected" or "Unable to download media".
      // Surface it (and the subcode), or a #100 is unactionable.
      const err =
        (json.error as
          | { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } }
          | undefined) ?? {};
      // Full object to the Worker log (wrangler tail) — the surfaced string is
      // trimmed for the operator; this keeps everything for diagnosis.
      console.error("[wa] graph error", path, JSON.stringify(json.error ?? json));
      const detail = err.error_data?.details;
      const parts = [err.message, detail && detail !== err.message ? `— ${detail}` : ""].filter(Boolean).join(" ");
      const codes = [err.code && `#${err.code}`, err.error_subcode && `/${err.error_subcode}`].filter(Boolean).join("");
      return { ok: false, error: parts ? `${parts}${codes ? ` (${codes})` : ""}` : `Graph API ${res.status}` };
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
  headerHandle?: string;
  urlButton?: { text: string; urlBase: string; exampleSuffix: string };
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

/** The app id that owns this token — needed to open a resumable upload session.
 *  Read from the token itself (debug_token) so no extra secret is required. */
async function appIdFromToken(token: string): Promise<string | null> {
  const r = await graph(`debug_token?input_token=${encodeURIComponent(token)}`, { method: "GET" }, token);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id = r.ok ? String((r.data as any)?.data?.app_id ?? "") : "";
  return id || null;
}

/** Upload a sample document via Meta's resumable upload API and return a
 *  header_handle — the example a DOCUMENT-header template must carry at creation.
 *  Two calls: open a session (Bearer), then POST the bytes (OAuth scheme). */
export async function uploadHeaderSample(
  bytes: Uint8Array,
  filename: string,
  mime: string,
): Promise<WaResult<string>> {
  const e = waEnv();
  if (!e.token) return { ok: false, error: NOT_CONFIGURED };
  const appId = await appIdFromToken(e.token);
  if (!appId) return { ok: false, error: "Couldn't resolve the Meta app id from the token." };
  try {
    const q = `file_name=${encodeURIComponent(filename)}&file_length=${bytes.length}&file_type=${encodeURIComponent(mime)}`;
    const sRes = await fetch(`${GRAPH}/${appId}/uploads?${q}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${e.token}` },
    });
    const sJson = (await sRes.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionId = typeof sJson.id === "string" ? sJson.id : "";
    if (!sessionId) {
      console.error("[wa] upload session failed", JSON.stringify(sJson));
      return { ok: false, error: "Couldn't open the sample upload session." };
    }
    // fetch's BodyInit type here rejects a Uint8Array — hand it a plain
    // ArrayBuffer of exactly these bytes (slice() copies to a tight buffer).
    const body = bytes.slice().buffer as ArrayBuffer;
    const uRes = await fetch(`${GRAPH}/${sessionId}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${e.token}`, file_offset: "0" },
      body,
    });
    const uJson = (await uRes.json().catch(() => ({}))) as Record<string, unknown>;
    const handle = typeof uJson.h === "string" ? uJson.h : "";
    if (!handle) {
      console.error("[wa] upload bytes failed", JSON.stringify(uJson));
      return { ok: false, error: "Couldn't upload the sample document to Meta." };
    }
    return { ok: true, data: handle };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
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

/**
 * Turn a Meta delivery-failure error into a sentence the operator can act on —
 * the raw title ("Message undeliverable") tells them nothing about what to do.
 * Shown verbatim under the failed message in the inbox.
 * Codes: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function explainWaFailure(err: any): string {
  const code = Number(err?.code);
  const title = (err?.title as string) || (err?.message as string) || "Delivery failed";
  const map: Record<number, string> = {
    131026: "This number isn't reachable on WhatsApp — it may not have a WhatsApp account, or hasn't accepted WhatsApp's terms. Check the number or send by email instead.",
    131030: "This number isn't on the WhatsApp test-recipient list. Add it in Meta, or verify the business to message any number.",
    131047: "The 24-hour reply window has closed — send an approved template to re-open the conversation.",
    131049: "WhatsApp held this back to limit marketing frequency to this contact. Try again later or send by email.",
    131051: "WhatsApp couldn't accept this message type.",
    131053: "WhatsApp couldn't fetch the attached PDF in time. Try again.",
    132000: "The template's fill-in values didn't match its approved format.",
    132001: "This template isn't approved (or was paused) — check it in Marketing.",
    133010: "The WhatsApp number isn't registered yet — finish the Meta setup.",
    190: "The WhatsApp access token has expired — reconnect WhatsApp in Settings.",
  };
  const help = map[code];
  if (help) return help;
  return code ? `${title} (WhatsApp error ${code})` : title;
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
