// Rolled-back proof that a marketing send can now claim a batch.
//
// The bug: claim_campaign_batch flips rows to 'sending', but the status check
// constraint only allowed seven values and 'sending' wasn't one — so the claim
// itself was rejected and no campaign ever sent a single message. The double-
// send guard made sending impossible.
//
// This drives the real RPC against real rows, then ROLLS BACK.
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

  const owner = (await c.query("select auth_user_id, tenant_id from app_users where role='owner' and is_active limit 1")).rows[0];
  const tenant = owner.tenant_id;
  const cust = (await c.query("select id from customers limit 3")).rows;
  if (!cust.length) throw new Error("need at least one customer");

  // A template + campaign to hang recipients off, created with RLS off so the
  // test doesn't depend on the composer.
  const tpl = (await c.query(
    `insert into wa_templates (tenant_id, name, language, category, body, status, variable_count)
     values ($1, 'zz_claim_probe', 'en', 'MARKETING', 'Hi {{1}}', 'approved', 1) returning id`,
    [tenant],
  )).rows[0];
  const camp = (await c.query(
    `insert into campaigns (tenant_id, name, wa_template_id, variable_map, audience, status)
     values ($1, 'zz claim probe', $2, '{}'::jsonb, '{}'::jsonb, 'draft') returning id`,
    [tenant, tpl.id],
  )).rows[0];
  for (const [i, cu] of cust.entries()) {
    await c.query(
      `insert into campaign_recipients (tenant_id, campaign_id, customer_id, phone_e164, variables, status)
       values ($1, $2, $3, $4, '["X"]'::jsonb, 'pending')`,
      [tenant, camp.id, cu.id, `2305000000${i}`],
    );
  }

  console.log("▸ the constraint");
  const def = (await c.query("select pg_get_constraintdef(oid) d from pg_constraint where conname='campaign_recipients_status_check'")).rows[0].d;
  check("'sending' is now allowed", /'sending'/.test(def), true);

  console.log("▸ a plain write of the status the RPC uses");
  await c.query("savepoint s");
  try {
    await c.query("update campaign_recipients set status='sending' where campaign_id=$1", [camp.id]);
    console.log("  ✓ status='sending' accepted (this is the exact write that was failing)");
    await c.query("rollback to savepoint s");
  } catch (e) {
    failures++;
    console.log(`  ✗ status='sending' STILL rejected: ${String(e.message).split("\n")[0]}`);
    await c.query("rollback to savepoint s");
  }

  console.log("▸ claim_campaign_batch, as the owner");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: owner.auth_user_id, role: "authenticated" })]);

  const first = await c.query("select * from public.claim_campaign_batch($1, 2)", [camp.id]);
  check("claims the batch it was asked for", first.rows.length, 2);
  check("…and marks them in-flight", first.rows.every((r) => r.status === "sending"), true);

  // The whole point of the claim: a second, overlapping send must not get the
  // same people — that would message a customer twice.
  const second = await c.query("select * from public.claim_campaign_batch($1, 2)", [camp.id]);
  check("an overlapping send gets a DISJOINT set", second.rows.length, 1);
  const overlap = first.rows.filter((a) => second.rows.some((b) => b.id === a.id)).length;
  check("no recipient is handed to both", overlap, 0);

  const third = await c.query("select * from public.claim_campaign_batch($1, 2)", [camp.id]);
  check("nothing left to claim", third.rows.length, 0);

  console.log("▸ finishing a claimed row");
  await c.query("set local role postgres");
  await c.query("update campaign_recipients set status='sent', wa_message_id='wamid.test' where id=$1", [first.rows[0].id]);
  const done = await c.query("select status from campaign_recipients where id=$1", [first.rows[0].id]);
  check("sending → sent", done.rows[0].status, "sent");
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(failures === 0 ? "\n✓ all checks passed (rolled back)" : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
