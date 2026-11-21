// Read-only: compare the Supabase migration tracker with supabase/migrations/*.sql, and list
// every live function that reads/writes the business_settings number counters.
import fs from "node:fs";
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
await c.query("set session characteristics as transaction read only");
const t = await c.query("select version from supabase_migrations.schema_migrations order by version");
const tracked = new Set(t.rows.map((r) => r.version));
const files = fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).map((f) => f.split("_")[0]);
const untracked = files.filter((v) => !tracked.has(v));
const missing = [...tracked].filter((v) => !files.includes(v));
console.log(`tracked ${tracked.size}, files ${files.length}`);
console.log("files NOT in tracker (db:push would RUN these):", untracked.join(", ") || "none");
console.log("tracker rows with no file:", missing.join(", ") || "none");
const ctr = await c.query(`select n.nspname||'.'||p.proname fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','app') and p.prosrc ~ '(invoice|quote|credit_note)_(next_number|prefix|number_padding)' order by 1`);
console.log("functions touching counters/prefixes:", ctr.rows.map((r) => r.fn).join(", "));
const trg = await c.query(`select tgname, tgrelid::regclass rel from pg_trigger where not tgisinternal and tgrelid::regclass::text in ('documents','document_lines','business_settings','products') order by 2,1`);
console.log("triggers:", trg.rows.map((r) => `${r.rel}.${r.tgname}`).join(", "));
await c.end();
