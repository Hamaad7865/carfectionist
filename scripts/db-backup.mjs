// Data-only snapshot of the hosted DB → backups/snapshot-<ts>/<table>.json
//   node scripts/db-backup.mjs
// Dumps every public base table plus auth.users identifiers. Combined with the
// committed migrations (which hold the schema), this is enough to reconstruct
// the tenant's data. Read-only against the DB. backups/ is gitignored.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = resolve(process.cwd(), "backups", `snapshot-${stamp}`);
mkdirSync(dir, { recursive: true });

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

const { rows: tables } = await c.query(`
  select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name`);

const manifest = {};
for (const { table_name } of tables) {
  const { rows } = await c.query(`select coalesce(json_agg(t), '[]'::json) as j from public."${table_name}" t`);
  const data = rows[0].j;
  writeFileSync(resolve(dir, `${table_name}.json`), JSON.stringify(data));
  manifest[table_name] = data.length;
}

// Auth identities (ids/emails only — password hashes are not exportable via SQL).
const { rows: authRows } = await c.query(`select id, email, created_at, last_sign_in_at from auth.users order by created_at`);
writeFileSync(resolve(dir, `_auth_users.json`), JSON.stringify(authRows));
manifest["_auth_users(identifiers)"] = authRows.length;

writeFileSync(resolve(dir, `_manifest.json`), JSON.stringify(manifest, null, 2));
console.log("✓ Backup →", dir);
console.log(JSON.stringify(manifest, null, 2));
await c.end();
