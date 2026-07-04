// Generate TypeScript types from the hosted schema into the web app.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_URL, requireEnv } from './_env.mjs';

requireEnv('SUPABASE_DB_URL', DB_URL);

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = resolve(__dirname, '..', 'apps', 'web', 'src', 'lib', 'supabase', 'database.types.ts');

console.log('→ Generating database.types.ts…');
const r = spawnSync(
  'npx',
  ['--yes', 'supabase', 'gen', 'types', 'typescript', '--db-url', DB_URL, '--schema', 'public'],
  { encoding: 'utf8', shell: true }
);
if (r.status !== 0) {
  console.error(r.stderr || 'type generation failed');
  process.exit(r.status ?? 1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, r.stdout, 'utf8');
console.log(`✓ Wrote ${out}`);
