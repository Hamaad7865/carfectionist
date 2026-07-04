// Push all migrations in supabase/migrations to the hosted project.
// Uses --db-url so no `supabase login` / linked project is required.
import { spawnSync } from 'node:child_process';
import { DB_URL, requireEnv } from './_env.mjs';

requireEnv('SUPABASE_DB_URL', DB_URL);

console.log('→ Pushing migrations to the hosted database…');
const r = spawnSync(
  'npx',
  ['--yes', 'supabase', 'db', 'push', '--include-all', '--db-url', DB_URL],
  { stdio: 'inherit', shell: true }
);
process.exit(r.status ?? 1);
