// Shared env loader for the DB scripts. Loads the repo-root .env.
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

export const PROJECT_REF = process.env.SUPABASE_PROJECT_REF?.trim();
export const DB_URL = process.env.SUPABASE_DB_URL?.trim();
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
export const SUPABASE_URL = PROJECT_REF ? `https://${PROJECT_REF}.supabase.co` : undefined;

export function requireEnv(name, value) {
  if (!value) {
    console.error(`\n✗ Missing ${name} in .env — see .env.example for where to find it.\n`);
    process.exit(1);
  }
  return value;
}
