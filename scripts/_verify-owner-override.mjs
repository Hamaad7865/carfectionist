// Rolled-back verification for the owner override.
//
// A cashier cannot discount a service or reverse a payment. An OWNER's PIN, checked
// server-side, raises the ceiling to a STATED figure — never to "unlimited", so an
// approval cannot be edited upward afterwards. Runs service-role, then ROLLS BACK.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");

  const owner = (await c.query(
    "select id, tenant_id from public.app_users where role='owner' and is_active order by created_at limit 1",
  )).rows[0];
  const other = (await c.query(
    "select id from public.app_users where role <> 'owner' and is_active order by created_at limit 1",
  )).rows[0];

  // Give both a known PIN for the length of this transaction.
  await c.query(
    "update public.app_users set pin_hash = extensions.crypt('4321', extensions.gen_salt('bf')), pin_attempts = 0, pin_locked_until = null where id = any($1::uuid[])",
    [[owner.id, other?.id].filter(Boolean)],
  );

  const doc = (await c.query(
    "select id from public.documents where tenant_id = $1 order by created_at desc limit 1", [owner.tenant_id],
  )).rows[0];

  console.log("▸ an owner's PIN records an override");
  // The RPC answers with jsonb {ok, override} rather than the row — a rejected
  // PIN has to come back as a value, not an exception, or the raise rolls back
  // the attempt counter and the lockout never engages (20260810000080).
  const call = async (pin, reason = "goodwill", scope = { max_discount_incl: 500 }) =>
    (await c.query(
      "select app.record_owner_override($1::uuid, $2, 'discount', 'document', $3::uuid, $4, $5::jsonb) as r",
      [owner.id, pin, doc.id, reason, JSON.stringify(scope)],
    )).rows[0].r;

  const ok = await call("4321");
  check("it reports success", ok.ok, true);
  check("it is stamped with the approver", ok.override.approved_by, owner.id);
  check("it states a ceiling, not a yes", ok.override.scope.max_discount_incl, 500);

  console.log("▸ a wrong PIN answers, it does not throw");
  const bad = await call("0000");
  check("ok is false", bad.ok, false);
  check("and it says why", bad.reason, "bad_pin");
  // The whole point of answering rather than raising: the attempt is counted.
  const attempts = (await c.query("select pin_attempts from public.app_users where id=$1", [owner.id])).rows[0].pin_attempts;
  check("the guess was counted against the account", Number(attempts) > 0, true);

  console.log("▸ what it refuses");
  const refuses = async (label, sql, params) => {
    let msg = "accepted";
    try {
      await c.query("savepoint s");
      await c.query(sql, params);
    } catch (e) { msg = e.message; }
    await c.query("rollback to savepoint s");
    check(label, msg !== "accepted", true);
    return msg;
  };
  // A wrong PIN is checked above — it ANSWERS rather than raising. What still
  // raises is a caller mistake: an approver who is not an owner, or no reason.
  if (other) {
    await refuses("a correct PIN belonging to a non-owner", "select app.record_owner_override($1::uuid,'4321','discount','document',$2::uuid,'x','{}'::jsonb)", [other.id, doc.id]);
  }
  await refuses("no reason", "select app.record_owner_override($1::uuid,'4321','discount','document',$2::uuid,'   ','{}'::jsonb)", [owner.id, doc.id]);
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — nothing persisted (rolled back)." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
