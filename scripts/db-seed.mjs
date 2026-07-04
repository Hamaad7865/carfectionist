// Run supabase/seed.sql against the hosted database (idempotent — safe to re-run).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DB_URL, requireEnv } from './_env.mjs';

requireEnv('SUPABASE_DB_URL', DB_URL);

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(__dirname, '..', 'supabase', 'seed.sql'), 'utf8');

const client = new pg.Client({ connectionString: DB_URL });
try {
  await client.connect();
  console.log('→ Seeding (supabase/seed.sql)…');
  await client.query(sql);
  console.log('✓ Seed complete.');
} catch (err) {
  console.error('✗ Seed failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
