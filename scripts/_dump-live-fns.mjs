// Read-only: dump the LIVE definition of every overload of the named functions (public + app
// schemas) into a folder, and print how many overloads each has. Bodies patched in place by
// later migrations make the files unreliable; this is the truth to start an edit from.
// Usage: node --env-file=C:/Projects/Carfection/.env scripts/_dump-live-fns.mjs <out_dir> name1 name2 ...
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const [, , outDir, ...names] = process.argv;
const url = process.env.SUPABASE_DB_URL;
if (!url || !outDir || names.length === 0) {
  console.error("usage: _dump-live-fns.mjs <out_dir> <fn> [...]  (needs SUPABASE_DB_URL)");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("set session characteristics as transaction read only");
for (const name of names) {
  const r = await client.query(
    `select n.nspname as schema, p.oid, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.proname = $1 and n.nspname in ('public','app') order by n.nspname, p.oid`,
    [name],
  );
  console.log(`${name}: ${r.rows.length} overload(s)${r.rows.map((x) => `\n   ${x.schema}.${name}(${x.args})`).join("")}`);
  r.rows.forEach((x, i) => {
    const file = path.join(outDir, `${x.schema}.${name}${r.rows.length > 1 ? `.${i + 1}` : ""}.sql`);
    fs.writeFileSync(file, x.def + "\n", "utf8");
  });
}
// Every function body that calls the numbering seam (the cut-over must repoint them all).
const callers = await client.query(
  `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','app') and p.prosrc ilike '%next_document_number%' order by 1`,
);
console.log("callers of next_document_number:", callers.rows.map((r) => r.fn).join(", "));
const vat15 = await client.query(
  `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','app') and p.prosrc ~ 'vat_rate[^,]*,\\s*15\\)' order by 1`,
);
console.log("functions with a 15% VAT fallback:", vat15.rows.map((r) => r.fn).join(", "));
await client.end();
