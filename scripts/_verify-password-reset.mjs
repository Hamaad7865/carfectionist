// The reset chain, proven against the real project on a throwaway user.
//
// "Bug free" for a password reset means specific things, and every one of them
// is a way real flows break:
//   • the emailed token actually redeems into a session
//   • the new password works AND the old one stops working
//   • the token is single-use — a mail client that pre-fetches links, or a
//     refresh, must not be able to burn someone's reset
//   • a garbage/tampered token gets nothing
//   • the throttle table is sealed from the browser
// Nothing is left behind: the throwaway user is deleted at the end.
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SUPABASE_URL, SERVICE_ROLE_KEY, DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_PROJECT_REF", SUPABASE_URL);
requireEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

// The anon key lives with the web app, not in the repo-root .env the DB scripts
// share — the redeem step runs as anon, exactly as a signed-out browser would.
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", ".env.local") });
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
if (!ANON) {
  console.error("\n✗ Missing NEXT_PUBLIC_SUPABASE_ANON_KEY in .env — the reset redeem runs as anon.\n");
  process.exit(1);
}

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const fresh = () => createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const db = new pg.Client({ connectionString: DB_URL });
await db.connect();

const stamp = String(Math.floor(Date.now() / 1000));
const email = `carfectionist+zreset-${stamp}@gmail.com`;
const OLD = "OldPassword#2026";
const NEW = "NewPassword#2026";
let userId = null;

try {
  console.log("▸ throwaway account");
  const { data: made, error: mkErr } = await admin.auth.admin.createUser({ email, password: OLD, email_confirm: true });
  if (mkErr) throw mkErr;
  userId = made.user.id;
  const pre = await fresh().auth.signInWithPassword({ email, password: OLD });
  check("signs in with the old password", !pre.error, true);

  console.log("▸ the token the email carries");
  const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (lErr) throw lErr;
  const tokenHash = link?.properties?.hashed_token;
  check("generateLink returns a recovery token", !!tokenHash, true);

  console.log("▸ redeeming it (what /auth/reset does)");
  const redeemer = fresh();
  const { data: sess, error: vErr } = await redeemer.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  check("redeems into a real session", !!sess?.session?.access_token, true);
  check("…for the right person", sess?.user?.email, email);
  if (vErr) console.log("     verify error:", vErr.message);

  console.log("▸ setting the new password (what /update-password does)");
  const { error: upErr } = await redeemer.auth.updateUser({ password: NEW });
  check("password updates on that session", !upErr, true);
  if (upErr) console.log("     update error:", upErr.message);

  const withNew = await fresh().auth.signInWithPassword({ email, password: NEW });
  check("the NEW password works", !withNew.error, true);
  const withOld = await fresh().auth.signInWithPassword({ email, password: OLD });
  check("the OLD password no longer works", !!withOld.error, true);

  console.log("▸ the token is spent");
  const replay = await fresh().auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  check("the same link can't be used twice", !!replay.error, true);

  console.log("▸ nonsense tokens get nothing");
  const junk = await fresh().auth.verifyOtp({ type: "recovery", token_hash: "not-a-real-token-" + stamp });
  check("a made-up token is refused", !!junk.error, true);

  console.log("▸ the throttle table is sealed from the browser");
  const ins = await admin.from("password_reset_attempts").insert({ email_key: email, ip: "203.0.113.9" });
  check("the service role can record an attempt", !ins.error, true);
  const anonRead = await fresh().from("password_reset_attempts").select("id");
  check("a signed-out browser reads nothing", (anonRead.data ?? []).length, 0);

  // Even a signed-in staff member must not see it. The grant was revoked as well
  // as RLS enabled, so this is refused before RLS is even consulted — the query
  // ERRORS rather than returning an empty set, which is the stronger outcome.
  const staff = await db.query("select auth_user_id from app_users where is_active limit 1");
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: staff.rows[0].auth_user_id, role: "authenticated" })]);
    const asStaff = await db.query("select count(*)::int n from password_reset_attempts");
    check("a signed-in staff member reads nothing", asStaff.rows[0].n, 0);
  } catch (e) {
    const denied = /permission denied/i.test(e.message);
    if (!denied) failures++;
    console.log(`  ${denied ? "✓" : "✗"} a signed-in staff member is refused outright: ${String(e.message).slice(0, 46)}`);
  } finally {
    await db.query("rollback"); // must run, or the role leaks into the cleanup below
  }
  await admin.from("password_reset_attempts").delete().eq("email_key", email);
} finally {
  if (userId) {
    await admin.auth.admin.deleteUser(userId);
    const { rows } = await db.query("select count(*)::int n from auth.users where id = $1", [userId]);
    console.log(`\n▸ cleanup: throwaway account rows left = ${rows[0].n}`);
    if (rows[0].n !== 0) failures++;
  }
  await db.end();
}

console.log(failures === 0 ? "\n✓ all checks passed (nothing left behind)" : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
