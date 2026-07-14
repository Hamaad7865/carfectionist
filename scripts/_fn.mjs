// Print a pg function body plainly (no table formatting):  node scripts/_fn.mjs <name>
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

const name = process.argv[2];
requireEnv("SUPABASE_DB_URL", DB_URL);
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
const { rows } = await c.query("select pg_get_functiondef(oid) as def from pg_proc where proname = $1", [name]);
for (const r of rows) console.log(r.def);
await c.end();
