// One-time go-live provisioning: replace the seed logins with the studio's 8
// real staff. Each gets a web login (email + password) and a 4-digit Android
// PIN. Creates the new logins FIRST, then deletes the old ones, so the app is
// never left without a login. Uses the GoTrue admin REST API (service role,
// server-side) + a direct DB connection for app_users + pin_hash.
//   node scripts/provision-staff.mjs
import pg from "pg";
import { randomInt } from "node:crypto";
import { DB_URL, SUPABASE_URL, SERVICE_ROLE_KEY, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
requireEnv("SUPABASE_URL", SUPABASE_URL);
requireEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

const PASSWORD = "Carfection#2026";
const STAFF = [
  { first: "anesh", name: "Anesh", role: "owner" },
  { first: "diksha", name: "Diksha", role: "owner" },
  { first: "anshika", name: "Anshika", role: "manager" },
  { first: "nick", name: "Nick", role: "manager" },
  { first: "kavish", name: "Kavish", role: "manager" },
  { first: "thierry", name: "Thierry", role: "manager" },
  { first: "nikka", name: "Nikka", role: "technician" },
  { first: "yohan", name: "Yohan", role: "technician" },
];

// distinct 4-digit PINs, avoiding trivial/guessable patterns
function genPins(n) {
  const bad = new Set(["0000","1111","2222","3333","4444","5555","6666","7777","8888","9999","1234","4321","1212","2121","0123","9876"]);
  const pins = new Set();
  while (pins.size < n) { const p = String(randomInt(1000, 10000)); if (!bad.has(p)) pins.add(p); }
  return [...pins];
}

const H = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
const admin = (path, opts = {}) => fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, { ...opts, headers: H });

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
const tenant = (await c.query("select id from business_settings limit 1")).rows[0].id;

// capture the current (old) logins to remove afterwards
const oldLogins = (await c.query("select auth_user_id, display_name from app_users")).rows;

// 1) create the 8 new logins first
const pins = genPins(STAFF.length);
const created = [];
for (let i = 0; i < STAFF.length; i++) {
  const s = STAFF[i];
  const email = `carfectionist+${s.first}@gmail.com`;
  const res = await admin("/users", { method: "POST", body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: s.name, role: s.role } }) });
  const body = await res.json();
  if (!res.ok || !body.id) { console.error("✗ create failed:", email, res.status, JSON.stringify(body)); process.exit(1); }
  await c.query("insert into app_users (id, tenant_id, auth_user_id, role, display_name, is_active) values (gen_random_uuid(), $1, $2, $3, $4, true)", [tenant, body.id, s.role, s.name]);
  await c.query("update app_users set pin_hash = extensions.crypt($1, extensions.gen_salt('bf')), pin_set_at = now() where auth_user_id = $2", [pins[i], body.id]);
  created.push({ name: s.name, role: s.role, email, pin: pins[i] });
  console.log(`created ${s.name} (${s.role})`);
}

// 2) remove the old seed logins (cascade drops their app_users rows)
for (const u of oldLogins) {
  const r = await admin(`/users/${u.auth_user_id}`, { method: "DELETE" });
  console.log(`removed old login ${u.display_name}: ${r.status}`);
}

console.log("\n=== 8 STAFF PROVISIONED (password for all: " + PASSWORD + ") ===");
for (const u of created) console.log(`${u.name.padEnd(9)} | ${u.role.padEnd(10)} | ${u.email.padEnd(34)} | PIN ${u.pin}`);
await c.end();
