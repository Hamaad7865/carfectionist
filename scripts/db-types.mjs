// Generate TypeScript types from the hosted schema — Docker-free, via the
// Supabase Management API (the CLI's `gen types` needs a container runtime).
// Requires SUPABASE_ACCESS_TOKEN (a personal access token from
// https://supabase.com/dashboard/account/tokens). Skips gracefully if absent.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_REF, ACCESS_TOKEN, requireEnv } from './_env.mjs';

requireEnv('SUPABASE_PROJECT_REF', PROJECT_REF);

if (!ACCESS_TOKEN) {
  console.warn(
    '⚠ Skipping type generation — no SUPABASE_ACCESS_TOKEN in .env.\n' +
    '  Create one at https://supabase.com/dashboard/account/tokens and add it to\n' +
    '  .env to generate types Docker-free. The app runs fine without it for now.'
  );
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = resolve(__dirname, '..', 'apps', 'web', 'src', 'lib', 'supabase', 'database.types.ts');

console.log('→ Generating database.types.ts via the Management API…');
const res = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/types/typescript?included_schemas=public`,
  { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
);
if (!res.ok) {
  console.error(`✗ Management API returned ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const { types } = await res.json();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, types, 'utf8');
console.log(`✓ Wrote ${out}`);
