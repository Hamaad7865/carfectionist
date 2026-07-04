// Fixed identities shared by seed-users.mjs (auth.users) and supabase/seed.sql
// (app_users). The UUIDs below MUST match the auth_user_id values in seed.sql.
export const TENANT_ID = '11111111-1111-4111-8111-000000000001';

export const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD?.trim() || 'Carfection#2026';

export const STAFF = [
  { authId: 'a0000000-0000-4000-a000-000000000001', email: 'carfectionist@gmail.com', role: 'owner',      displayName: 'Rakesh (Owner)' },
  { authId: 'a0000000-0000-4000-a000-000000000002', email: 'cashier@carfectionist.mu', role: 'cashier',    displayName: 'Priya (Cashier)' },
  { authId: 'a0000000-0000-4000-a000-000000000003', email: 'tech1@carfectionist.mu',   role: 'technician', displayName: 'Deven (Technician)' },
  { authId: 'a0000000-0000-4000-a000-000000000004', email: 'tech2@carfectionist.mu',   role: 'technician', displayName: 'Yash (Technician)' },
  { authId: 'a0000000-0000-4000-a000-000000000005', email: 'tech3@carfectionist.mu',   role: 'technician', displayName: 'Kevin (Technician)' },
];
