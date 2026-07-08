// One-off read-only query helper (dev only). Usage: node scripts/q.mjs "select ..."
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";
requireEnv("SUPABASE_DB_URL", DB_URL);
const sql = process.argv[2];
if (!sql) { console.error("usage: node scripts/q.mjs \"<sql>\""); process.exit(1); }
const client = new pg.Client({ connectionString: DB_URL });
try {
  await client.connect();
  const r = await client.query(sql);
  console.table(r.rows);
} catch (err) {
  console.error("✗", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
