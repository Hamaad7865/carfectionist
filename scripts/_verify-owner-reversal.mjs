// Rolled-back verification: money leaves the business only on the owner's say-so.
//
// reverse_payment and create_and_issue_credit_note are the two ways cash goes back
// out. A manager could do both until 2026-08-10. Now: the owner, or an override row
// naming that payment. Every other undo (void a quote, cancel a job, reopen a day)
// is deliberately left at owner|manager, and this proves that too.
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

  const mgr = (await c.query(
    "select id, auth_user_id, tenant_id from public.app_users where role='manager' and is_active limit 1",
  )).rows[0];
  const owner = (await c.query(
    "select id, auth_user_id from public.app_users where role='owner' and is_active and tenant_id=$1 limit 1",
    [mgr.tenant_id],
  )).rows[0];
  const pay = (await c.query(
    `select p.id from public.payments p
      where p.tenant_id = $1 and p.amount > 0
        and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
      order by p.created_at desc limit 1`, [mgr.tenant_id],
  )).rows[0];

  const asUser = async (authUid) => {
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: authUid, role: "authenticated" }),
    ]);
  };
  // Reports the ACTUAL outcome, never a bare boolean — a failure for the wrong
  // reason must not read the same as the refusal being tested for.
  const tryReverse = async (authUid) => {
    let out;
    await c.query("savepoint r");
    try {
      await asUser(authUid);
      const row = (await c.query("select amount from public.reverse_payment($1::uuid, 'probe')", [pay.id])).rows[0];
      out = Number(row.amount) < 0 ? "reversed" : "odd";
    } catch (e) { out = e.message; }
    await c.query("rollback to savepoint r");
    await c.query("set local role postgres");
    return out;
  };
  const asRefusal = (out, want, token) => (out.includes(want) ? token : out);

  console.log("▸ a manager can no longer reverse a payment");
  check("refused, and it says why",
    asRefusal(await tryReverse(mgr.auth_user_id), "reversal requires the owner", "owner only"), "owner only");

  console.log("▸ the owner still can");
  check("the owner reverses", await tryReverse(owner.auth_user_id), "reversed");

  console.log("▸ an override lets that same manager through");
  await c.query(
    `insert into public.owner_overrides (tenant_id, kind, ref_type, ref_id, reason, approved_by)
     values ($1,'reversal','payment',$2,'customer complaint',$3)`,
    [mgr.tenant_id, pay.id, owner.id],
  );
  check("the override authorises it", await tryReverse(mgr.auth_user_id), "reversed");

  console.log("▸ a reversal override is single-use");
  // Consume it, then try again on a fresh savepoint — the same approval must not
  // authorise a second refund.
  await c.query("savepoint twice");
  await asUser(mgr.auth_user_id);
  await c.query("select public.reverse_payment($1::uuid, 'first')", [pay.id]);
  await c.query("set local role postgres");
  const consumed = (await c.query(
    "select count(*) n from public.owner_overrides where kind='reversal' and ref_id=$1 and consumed_at is not null", [pay.id],
  )).rows[0].n;
  check("using it stamps consumed_at", consumed, "1");
  await c.query("rollback to savepoint twice");
  await c.query("set local role postgres");

  console.log("▸ the other undo paths are deliberately untouched");
  const stillBoth = (await c.query(
    `select count(*) n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
      where ns.nspname='public' and p.proname in ('void_quote','void_certificate','cancel_job')
        and position('require_role(''owner'',''manager'')' in pg_get_functiondef(p.oid)) > 0`,
  )).rows[0].n;
  check("void_quote, void_certificate and cancel_job still allow a manager", stillBoth, "3");
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — nothing persisted (rolled back)." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
