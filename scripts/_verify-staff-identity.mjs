// Does an admin-initiated email change actually take effect?
//
// This is the one thing the identity editor cannot be shipped on faith about.
// Supabase can treat an email change as PENDING — writing it to
// auth.users.email_change and leaving the old address live until someone clicks
// a confirmation link. If that were the behaviour here, the owner would rename
// someone's login, see success, and the staff member would still be signing in
// with the old address (or worse, be locked out waiting on a link sent to an
// inbox they don't read).
//
// So: create a throwaway user, change its email the exact way the action does,
// read auth.users back over a DIRECT DB connection (not the API's own view of
// itself), and prove the new address is live and confirmed. Then delete it.
// Nothing is left behind.
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { SUPABASE_URL, SERVICE_ROLE_KEY, DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_PROJECT_REF", SUPABASE_URL);
requireEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const db = new pg.Client({ connectionString: DB_URL });
await db.connect();

const stamp = process.argv[2] ?? String(Math.floor(Date.now() / 1000));
const oldEmail = `carfectionist+ztest-${stamp}-a@gmail.com`;
const newEmail = `carfectionist+ztest-${stamp}-b@gmail.com`;
let userId = null;

try {
  console.log("▸ throwaway user");
  const { data: made, error: mkErr } = await admin.auth.admin.createUser({
    email: oldEmail,
    password: "Throwaway#2026",
    email_confirm: true,
    user_metadata: { display_name: "Ztest Before" },
  });
  if (mkErr) throw mkErr;
  userId = made.user.id;
  check("created with the old address", made.user.email, oldEmail);

  console.log("▸ the change the action makes");
  const { error: upErr } = await admin.auth.admin.updateUserById(userId, { email: newEmail, email_confirm: true });
  if (upErr) throw upErr;

  // Read the raw row — the question is what auth.users ACTUALLY holds.
  const { rows } = await db.query(
    "select email, email_change, email_confirmed_at, raw_user_meta_data->>'display_name' name from auth.users where id = $1",
    [userId],
  );
  const row = rows[0];
  check("auth.users.email is the NEW address", row.email, newEmail);
  check("no change left pending (email_change empty)", row.email_change === "" || row.email_change === null, true);
  check("the new address is confirmed, so they can sign in now", row.email_confirmed_at !== null, true);

  console.log("▸ display_name in user_metadata moves too");
  const { data: got } = await admin.auth.admin.getUserById(userId);
  await admin.auth.admin.updateUserById(userId, { user_metadata: { ...(got.user.user_metadata ?? {}), display_name: "Ztest After" } });
  const { rows: r2 } = await db.query("select raw_user_meta_data->>'display_name' name from auth.users where id = $1", [userId]);
  check("metadata name updated", r2[0].name, "Ztest After");

  console.log("▸ a colliding address");
  const { data: other } = await admin.auth.admin.createUser({ email: `carfectionist+ztest-${stamp}-c@gmail.com`, password: "Throwaway#2026", email_confirm: true });
  const { error: dupErr } = await admin.auth.admin.updateUserById(other.user.id, { email: newEmail, email_confirm: true });
  check("GoTrue does reject it", !!dupErr, true);
  // …but uselessly. This is WHY auth_email_taken exists: the owner would
  // otherwise be shown the literal string "{}" as the reason.
  check("its message is unusable, as expected", JSON.stringify(dupErr?.message), '"{}"');

  console.log("▸ auth_email_taken — the guard that catches it first");
  // The function reads the CALLER's role, so it has to be asked as a real
  // signed-in owner, exactly as the server action asks it.
  const staff = await db.query(
    "select auth_user_id, role::text from app_users where is_active and role in ('owner','technician','cashier') order by (role='owner') desc",
  );
  const owner = staff.rows.find((s) => s.role === "owner");
  const lowly = staff.rows.find((s) => s.role !== "owner");
  await db.query("begin");
  await db.query("set local role authenticated");
  const as = (authId) => db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: authId, role: "authenticated" })]);
  await as(owner.auth_user_id);

  const taken = await db.query("select public.auth_email_taken($1, null) t", [newEmail]);
  check("says a used address is taken", taken.rows[0].t, true);
  const free = await db.query("select public.auth_email_taken($1, null) t", [`carfectionist+ztest-${stamp}-free@gmail.com`]);
  check("says an unused address is free", free.rows[0].t, false);
  const self = await db.query("select public.auth_email_taken($1, $2) t", [newEmail, userId]);
  check("excludes the user themselves (re-saving your own address is fine)", self.rows[0].t, false);
  const cased = await db.query("select public.auth_email_taken($1, null) t", [newEmail.toUpperCase()]);
  check("is case-insensitive", cased.rows[0].t, true);

  console.log("▸ and it is owner-only");
  if (lowly) {
    await db.query("savepoint s");
    await as(lowly.auth_user_id);
    try {
      await db.query("select public.auth_email_taken($1, null)", [newEmail]);
      failures++;
      console.log(`  ✗ a ${lowly.role} could probe staff logins: ALLOWED (want denied)`);
    } catch (e) {
      console.log(`  ✓ a ${lowly.role} cannot probe staff logins: ${String(e.message).split("\n")[0].slice(0, 40)}`);
    }
    await db.query("rollback to savepoint s");
  }
  await db.query("rollback");
  await admin.auth.admin.deleteUser(other.user.id);
} finally {
  if (userId) {
    await admin.auth.admin.deleteUser(userId);
    const { rows } = await db.query("select count(*)::int n from auth.users where id = $1", [userId]);
    console.log(`\n▸ cleanup: throwaway user rows left = ${rows[0].n}`);
    if (rows[0].n !== 0) failures++;
  }
  await db.end();
}

console.log(failures === 0 ? "\n✓ all checks passed (nothing left behind)" : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
