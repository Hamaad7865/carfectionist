// Dev helper: dump a function's live definition to a UTF-8 file.
// Usage: node scripts/_dump-fn.mjs <function_name> <out_path>
import fs from "node:fs";
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";
requireEnv("SUPABASE_DB_URL", DB_URL);
const [, , fnName, outPath] = process.argv;
const client = new pg.Client({ connectionString: DB_URL });
await client.connect();
const r = await client.query("select pg_get_functiondef(oid) as def from pg_proc where proname = $1", [fnName]);
fs.writeFileSync(outPath, r.rows[0].def, "utf8");
await client.end();
console.log("written", r.rows[0].def.length, "chars");
