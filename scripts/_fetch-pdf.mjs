// Fetch a document PDF from PROD as the owner (bearer token) and save it,
// so pymupdf can verify geometry/artwork byte-level. Usage:
//   node scripts/_fetch-pdf.mjs <out.pdf>
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const out = process.argv[2] ?? "prod-doc.pdf";
const env = {};
for (const line of readFileSync("apps/web/.env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: docs } = await admin
  .from("documents")
  .select("id, number")
  .not("accepted_signature", "is", null)
  .not("number", "is", null)
  .order("created_at", { ascending: false })
  .limit(1);
const doc = docs?.[0];
if (!doc) { console.error("no signed quote found"); process.exit(1); }

const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: "carfectionist@gmail.com" });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: v } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });

// The authed PDF route is cookie-based; use the PUBLIC tokenized route instead?
// No token minting client-side — call the send route? Simplest: the /api/documents/[id]/pdf
// route uses cookie auth, so pass the session as a cookie header.
const session = JSON.stringify(v.session);
const b64 = "base64-" + Buffer.from(session, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const res = await fetch(`https://app-carfectionist.com/api/documents/${doc.id}/pdf`, {
  headers: { cookie: `sb-qecydemyqxdxwhkiyjtp-auth-token=${b64}` },
});
if (!res.ok) { console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(1); }
writeFileSync(out, Buffer.from(await res.arrayBuffer()));
console.log(`saved ${doc.number} → ${out}`);
