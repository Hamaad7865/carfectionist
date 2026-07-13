// Signed, unguessable links for the public ticket page (/t/[token]) — the
// "view my ticket" button in receipt emails. Customers aren't logged in, so
// possession of a valid token IS the authorisation; HMAC-SHA256 over the
// document id makes tokens unforgeable without the server secret. Web Crypto
// only (runs on workerd). Server-side only — never import from a client file.

import { serverEnv } from "@/lib/server-env";

const b64url = (buf: ArrayBuffer) =>
  Buffer.from(buf).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

function secret(): string {
  // A dedicated secret when configured; otherwise derived from the service-role
  // key (server-only either way). Rotating either invalidates old links — fine,
  // receipts can simply be re-sent.
  return serverEnv("RECEIPT_LINK_SECRET") || serverEnv("SUPABASE_SERVICE_ROLE_KEY") || "dev-only-secret";
}

async function sign(kind: string, docId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${kind}:${docId}`));
  return b64url(sig).slice(0, 24);
}

async function makeToken(kind: string, docId: string): Promise<string> {
  return `${Buffer.from(docId).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}.${await sign(kind, docId)}`;
}

async function verifyToken(kind: string, token: string): Promise<string | null> {
  const [idPart, sig] = token.split(".");
  if (!idPart || !sig) return null;
  try {
    const docId = Buffer.from(idPart.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
    if (!/^[0-9a-f-]{36}$/i.test(docId)) return null;
    const expect = await sign(kind, docId);
    return expect === sig ? docId : null;
  } catch {
    return null;
  }
}

export async function receiptToken(docId: string): Promise<string> {
  return makeToken("receipt", docId);
}

/** Returns the document id when the token is genuine, else null. */
export async function verifyReceiptToken(token: string): Promise<string | null> {
  return verifyToken("receipt", token);
}

/** Token for the public document-PDF link (emailed / fetched by WhatsApp).
 *  Distinct kind so a receipt token can never open a document and vice-versa. */
export async function docToken(docId: string): Promise<string> {
  return makeToken("doc", docId);
}

export async function verifyDocToken(token: string): Promise<string | null> {
  return verifyToken("doc", token);
}
