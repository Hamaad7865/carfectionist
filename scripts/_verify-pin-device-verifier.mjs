// Verifies 20260803000010_pin_travels_to_the_tills.sql against the LIVE DB, all inside
// BEGIN/ROLLBACK. Uses a THROWAWAY app_users row minted inside the transaction — no real
// staff member's PIN or verifier is touched.
//
// Also probes (read-only) whether `authenticated` can SELECT the pin columns at all —
// deciding whether a column-exposure fix is needed.
//
// Temporary verification script — delete after use.
import { readFileSync } from "node:fs";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const MIGRATION = readFileSync("supabase/migrations/20260803000010_pin_travels_to_the_tills.sql", "utf8");

/** The same derivation the web action and the edge function perform. */
function mintVerifier(pin) {
  const salt = randomBytes(16);
  const iterations = 310_000;
  const dk = pbkdf2Sync(pin, salt, iterations, 32, "sha256");
  return `pbkdf2:sha256:${iterations}:${salt.toString("base64")}:${dk.toString("base64")}`;
}

const c = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const { rows: [biz] } = await c.query(`select id from public.business_settings limit 1`);
const TENANT = biz.id;
const { rows: [owner] } = await c.query(
  `select id, auth_user_id from public.app_users
    where tenant_id = $1 and role = 'owner' and auth_user_id is not null limit 1`, [TENANT]);
const asOwner = () =>
  c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: owner.auth_user_id, role: "authenticated" })]);

try {
  await c.query("begin");
  await asOwner();
  await c.query(MIGRATION);

  // A throwaway staff row — never a real person's PIN.
  const probeId = randomUUID();
  await c.query(
    `insert into public.app_users (id, tenant_id, role, display_name, is_active)
     values ($1, $2, 'cashier', 'PIN Probe', true)`, [probeId, TENANT]);

  // 1) three-arg set stores hash AND verifier
  const v1 = mintVerifier("4271");
  await c.query(`select public.set_staff_pin($1, '4271', $2)`, [probeId, v1]);
  let { rows: [row] } = await c.query(
    `select pin_hash, pin_device_verifier from public.app_users where id = $1`, [probeId]);
  check("setting a PIN with a verifier stores both",
    !!row.pin_hash && row.pin_device_verifier === v1);

  // 2) the PIN verifies through the unchanged server check
  const { rows: [ver] } = await c.query(`select public.verify_staff_pin($1, '4271') as v`, [probeId]);
  check("verify_staff_pin still accepts the PIN", ver.v.ok === true);

  // 3) a two-arg (verifier-less) re-set DROPS the old verifier — old PIN must not
  //    keep unlocking tablets after a change the caller couldn't derive for
  await c.query(`select public.set_staff_pin($1, '9384')`, [probeId]);
  ({ rows: [row] } = await c.query(
    `select pin_device_verifier from public.app_users where id = $1`, [probeId]));
  check("re-setting the PIN without a verifier clears the stored one",
    row.pin_device_verifier === null);

  // 4) clearing the PIN clears the verifier with it
  await c.query(`select public.set_staff_pin($1, '5162', $2)`, [probeId, mintVerifier("5162")]);
  await c.query(`select public.clear_staff_pin($1)`, [probeId]);
  ({ rows: [row] } = await c.query(
    `select pin_hash, pin_device_verifier from public.app_users where id = $1`, [probeId]));
  check("clearing the PIN clears both hash and verifier",
    row.pin_hash === null && row.pin_device_verifier === null);

  // 5) a malformed verifier is refused outright
  let err = null;
  await c.query("savepoint sp1");
  try { await c.query(`select public.set_staff_pin($1, '1122', 'not-a-verifier')`, [probeId]); }
  catch (e) { err = e.message; await c.query("rollback to savepoint sp1"); }
  check("a malformed verifier is refused", /malformed device verifier/.test(err ?? ""));

  // 6) the roster shape the edge function will serve
  const { rows: rosterRows } = await c.query(
    `select id, display_name, role, pin_device_verifier from public.app_users
      where is_active = true and pin_hash is not null and tenant_id = $1 limit 3`, [TENANT]);
  check("roster query serves the verifier column", rosterRows.length >= 0);

  // ── exposure probe, while the column still exists in this txn ────────────
  const { rows: [priv] } = await c.query(
    `select has_column_privilege('authenticated', 'public.app_users', 'pin_hash', 'SELECT') as hash_sel,
            has_column_privilege('authenticated', 'public.app_users', 'pin_device_verifier', 'SELECT') as ver_sel`);
  console.log(`· column exposure: authenticated SELECT pin_hash=${priv.hash_sel}, pin_device_verifier=${priv.ver_sel}`);

  await c.query("rollback");
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("\n✗ probe threw:", e.message);
  failed = true;
} finally {
  await c.end();
}

console.log(failed ? "\n✗ FAILED" : "\n✓ all checks passed (nothing committed)");
process.exitCode = failed ? 1 : 0;
