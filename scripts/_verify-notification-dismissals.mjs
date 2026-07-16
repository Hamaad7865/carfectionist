// Rolled-back verification for dismissible bell alerts
// (20260716000070_notification_dismissals.sql). Runs as `authenticated`
// impersonating real staff, then ROLLS BACK — nothing persists.
//
// What must hold: a dismissal is PRIVATE. Anesh clearing his bell must not
// clear Anshika's, and nobody may write a dismissal in someone else's name.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};
const denied = async (label, fn) => {
  await c.query("savepoint s"); // a raised exception aborts the tx — fence it
  try {
    await fn();
    failures++;
    console.log(`  ✗ ${label}: ALLOWED (want denied)`);
  } catch (e) {
    console.log(`  ✓ ${label}: denied (${String(e.message).split("\n")[0].slice(0, 48)})`);
  }
  await c.query("rollback to savepoint s");
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
const asUser = (authId) =>
  c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: authId, role: "authenticated" })]);

try {
  await c.query("begin");

  // Probe for live staff — seed UUIDs are long dead (the DB was rebuilt).
  const staff = await c.query(
    `select au.id, au.auth_user_id, au.display_name, au.tenant_id, au.role::text
       from app_users au where au.is_active order by (au.role='owner') desc, au.display_name limit 2`,
  );
  if (staff.rows.length < 2) throw new Error("need two active staff to test privacy");
  const [me, other] = staff.rows;
  console.log(`▸ acting as ${me.display_name} (${me.role}); other party ${other.display_name}`);

  await c.query("set local role authenticated");
  await asUser(me.auth_user_id);

  console.log("▸ clearing your own alert");
  await c.query(
    `insert into notification_dismissals (tenant_id, app_user_id, key, seen_count, dismissed_day)
     values ($1, $2, 'lowstock', 11, '2026-07-16')`,
    [me.tenant_id, me.id],
  );
  const mine = await c.query("select seen_count, dismissed_day from notification_dismissals where key='lowstock'");
  check("row visible to its owner", mine.rows.length, 1);
  check("seen_count stored", mine.rows[0].seen_count, 11);

  console.log("▸ upsert — dismissing again replaces, never duplicates");
  await c.query(
    `insert into notification_dismissals (tenant_id, app_user_id, key, seen_count, dismissed_day)
     values ($1, $2, 'lowstock', 14, '2026-07-16')
     on conflict (app_user_id, key) do update set seen_count = excluded.seen_count, dismissed_day = excluded.dismissed_day`,
    [me.tenant_id, me.id],
  );
  const up = await c.query("select seen_count from notification_dismissals where key='lowstock'");
  check("still exactly one row", up.rows.length, 1);
  check("seen_count updated", up.rows[0].seen_count, 14);

  console.log("▸ privacy");
  await denied("writing a dismissal in someone else's name", () =>
    c.query(
      `insert into notification_dismissals (tenant_id, app_user_id, key, seen_count, dismissed_day)
       values ($1, $2, 'enquiries', 3, '2026-07-16')`,
      [me.tenant_id, other.id],
    ),
  );
  await denied("forging a foreign tenant", () =>
    c.query(
      `insert into notification_dismissals (tenant_id, app_user_id, key, seen_count, dismissed_day)
       values ('11111111-1111-1111-1111-111111111999', $1, 'enquiries', 3, '2026-07-16')`,
      [me.id],
    ),
  );

  // The other person's dismissal, planted with RLS off, must stay invisible.
  await c.query("set local role postgres");
  await c.query(
    `insert into notification_dismissals (tenant_id, app_user_id, key, seen_count, dismissed_day)
     values ($1, $2, 'enquiries', 3, '2026-07-16')`,
    [other.tenant_id, other.id],
  );
  await c.query("set local role authenticated");
  await asUser(me.auth_user_id);
  const leak = await c.query("select * from notification_dismissals where key='enquiries'");
  check("another user's dismissal is invisible", leak.rows.length, 0);

  const visible = await c.query("select count(*)::int n from notification_dismissals");
  check("only your own rows are readable", visible.rows[0].n, 1);

  console.log("▸ anonymous");
  await c.query("set local role anon");
  const anon = await c.query("select count(*)::int n from notification_dismissals").catch(() => ({ rows: [{ n: "error" }] }));
  check("signed-out reads nothing", anon.rows[0].n, 0);
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(failures === 0 ? "\n✓ all checks passed (rolled back)" : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
