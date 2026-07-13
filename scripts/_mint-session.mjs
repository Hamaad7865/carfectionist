// Mint a dev session for UI verification via admin magiclink (no password entry).
// Prints document.cookie assignments in @supabase/ssr chunked base64 format.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync("apps/web/.env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) { console.error("missing env"); process.exit(1); }

const admin = createClient(url, service, { auth: { persistSession: false } });
const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: "carfectionist@gmail.com",
});
if (linkErr) { console.error("generateLink:", linkErr.message); process.exit(1); }

const plain = createClient(url, anon, { auth: { persistSession: false } });
const { data: v, error: vErr } = await plain.auth.verifyOtp({
  type: "magiclink",
  token_hash: linkData.properties.hashed_token,
});
if (vErr || !v.session) { console.error("verifyOtp:", vErr?.message); process.exit(1); }

const ref = new URL(url).hostname.split(".")[0];
const name = `sb-${ref}-auth-token`;
const json = JSON.stringify(v.session);
const b64 = "base64-" + Buffer.from(json, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const MAX = 3180;
const chunks = [];
for (let i = 0; i < b64.length; i += MAX) chunks.push(b64.slice(i, i + MAX));
const cookies =
  chunks.length === 1
    ? [`${name}=${chunks[0]}`]
    : chunks.map((c, i) => `${name}.${i}=${c}`);
console.log(JSON.stringify(cookies));
