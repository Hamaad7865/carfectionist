// Signed, unguessable links for the public ticket page (/t/[token]) — the
// "view my ticket" button in receipt emails. Customers aren't logged in, so
// possession of a valid token IS the authorisation; HMAC-SHA256 over the
// document id makes tokens unforgeable without the server secret. Web Crypto
// only (runs on workerd). Server-side only — never import from a client file.

const b64url = (buf: ArrayBuffer) =>
  Buffer.from(buf).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

function secret(): string {
  // A dedicated secret when configured; otherwise derived from the service-role
  // key (server-only either way). Rotating either invalidates old links — fine,
  // receipts can simply be re-sent.
  return process.env.RECEIPT_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "dev-only-secret";
}

async function sign(docId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`receipt:${docId}`));
  return b64url(sig).slice(0, 24);
}

export async function receiptToken(docId: string): Promise<string> {
  return `${Buffer.from(docId).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}.${await sign(docId)}`;
}

/** Returns the document id when the token is genuine, else null. */
export async function verifyReceiptToken(token: string): Promise<string | null> {
  const [idPart, sig] = token.split(".");
  if (!idPart || !sig) return null;
  try {
    const docId = Buffer.from(idPart.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
    if (!/^[0-9a-f-]{36}$/i.test(docId)) return null;
    const expect = await sign(docId);
    return expect === sig ? docId : null;
  } catch {
    return null;
  }
}
