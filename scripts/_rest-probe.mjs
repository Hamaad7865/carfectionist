// Dev probe: run a raw PostgREST select the way the app does, to see the real error.
//   node scripts/_rest-probe.mjs "<table>" "<select>" "<query...>"
import { SUPABASE_URL, SERVICE_ROLE_KEY, requireEnv } from "./_env.mjs";

const [table, select, extra = ""] = process.argv.slice(2);
requireEnv("SUPABASE_PROJECT_REF", SUPABASE_URL);
requireEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${extra ? "&" + extra : ""}`;
const res = await fetch(url, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } });
console.log("HTTP", res.status);
console.log((await res.text()).slice(0, 1200));
