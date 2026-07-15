// Fetch the live Settings → WhatsApp page as the owner and report what it says.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const l of readFileSync("apps/web/.env.local","utf8").split(/\r?\n/)) { const m=/^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if(m) env[m[1]]=m[2].replace(/^"|"$/g,""); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const { data: link } = await admin.auth.admin.generateLink({ type:"magiclink", email:"carfectionist@gmail.com" });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth:{persistSession:false} });
const { data: v } = await anon.auth.verifyOtp({ type:"magiclink", token_hash: link.properties.hashed_token });
const b64 = "base64-" + Buffer.from(JSON.stringify(v.session),"utf8").toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const res = await fetch("https://app-carfectionist.com/settings/whatsapp", {
  headers: { cookie: `sb-qecydemyqxdxwhkiyjtp-auth-token=${b64}` },
});
const html = await res.text();
console.log("HTTP", res.status);
const txt = html.replace(/<script[\s\S]*?<\/script>/g,"").replace(/<[^>]+>/g," ").replace(/&[a-z]+;/g," ").replace(/\s+/g," ");
for (const probe of [
  "WhatsApp is connected", "WhatsApp isn't connected yet",
  "Missing in Cloudflare", "Access token", "App secret", "required to RECEIVE",
  "Callback URL", "Verify token", "Send a test message", "hello_world", "Where the four values go",
]) console.log((txt.includes(probe) ? "  ✓ " : "  ✗ ") + probe);
const m = /Missing in Cloudflare: ([^<]+?)(?: Live check|$)/.exec(txt);
if (m) console.log("\n  → page reports missing:", m[1].trim().slice(0,120));
