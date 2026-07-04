// Create the 5 staff auth users with fixed UUIDs (idempotent).
// Must run BEFORE db-seed.mjs, since app_users (in seed.sql) FK-references these.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SERVICE_ROLE_KEY, requireEnv } from './_env.mjs';
import { STAFF, STAFF_PASSWORD } from './seed-constants.mjs';

requireEnv('SUPABASE_PROJECT_REF (→ SUPABASE_URL)', SUPABASE_URL);
requireEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log('→ Creating staff auth users…');
let ok = 0;
for (const u of STAFF) {
  const { error } = await admin.auth.admin.createUser({
    id: u.authId,
    email: u.email,
    password: STAFF_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: u.displayName, role: u.role },
  });
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
      console.log(`  • ${u.email} — already exists, skipping`);
      ok++;
      continue;
    }
    console.error(`  ✗ ${u.email}: ${error.message}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`  ✓ ${u.email} (${u.role})`);
  ok++;
}
console.log(`Done — ${ok}/${STAFF.length} staff users present.`);
console.log(`Login password for all staff: ${STAFF_PASSWORD}`);
