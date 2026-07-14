// One-off: fire a real "Send to customer" email through the DEPLOYED Worker —
// end-to-end proof of PDF render + Email Sending binding + attachment.
// Sends the most recent SIGNED quote to the address in argv[2].
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const to = process.argv[2];
if (!to) { console.error("usage: node scripts/_send-test.mjs <email>"); process.exit(1); }

const env = {};
for (const line of readFileSync("apps/web/.env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Prefer a signed (accepted) quote so the email shows the acceptance stamp.
let { data: docs } = await admin
  .from("documents")
  .select("id, number, doc_type, status, accepted_signature")
  .not("accepted_signature", "is", null)
  .not("number", "is", null)
  .order("created_at", { ascending: false })
  .limit(1);
if (!docs?.length) {
  ({ data: docs } = await admin
    .from("documents")
    .select("id, number, doc_type, status")
    .not("number", "is", null)
    .order("created_at", { ascending: false })
    .limit(1));
}
const doc = docs?.[0];
if (!doc) { console.error("no sendable document found"); process.exit(1); }
console.log(`target: ${doc.number} (${doc.doc_type}, ${doc.status})${doc.accepted_signature ? " — SIGNED" : ""}`);

// Owner session via admin magiclink (no password anywhere).
const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: "carfectionist@gmail.com" });
if (lErr) { console.error("generateLink:", lErr.message); process.exit(1); }
const anon = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: v, error: vErr } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
if (vErr || !v.session) { console.error("verifyOtp:", vErr?.message); process.exit(1); }

const res = await fetch(`https://app-carfectionist.com/api/documents/${doc.id}/send`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${v.session.access_token}` },
  body: JSON.stringify({ channel: "email", to, deviceCode: "verify-script" }),
});
console.log("HTTP", res.status, await res.text());
