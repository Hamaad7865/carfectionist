// Execute an arbitrary SQL file against the hosted DB.
//   node scripts/db-exec.mjs supabase/migrations/xxxx.sql
// Use for re-applying idempotent CREATE OR REPLACE migrations during dev.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/db-exec.mjs <path-to.sql>");
  process.exit(1);
}
const sql = readFileSync(resolve(process.cwd(), file), "utf8");
const client = new pg.Client({ connectionString: DB_URL });
try {
  await client.connect();
  console.log(`→ Executing ${file}…`);
  await client.query(sql);
  console.log("✓ Done.");
} catch (err) {
  console.error("✗ Failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
