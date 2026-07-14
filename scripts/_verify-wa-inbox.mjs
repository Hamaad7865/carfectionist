// Rolled-back verification for 20260714000003_wa_inbox.sql — applies the
// migration inside a transaction, exercises the inbox, ROLLS BACK.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b";
let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260714000003_wa_inbox.sql"), "utf8");
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
const as = (uid) => c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);

try {
  await c.query("begin");
  console.log("▸ apply migration inside the transaction");
  await c.query(migration);
  check("wa-media bucket created (private)", (await c.query("select public from storage.buckets where id='wa-media'")).rows[0]?.public, "false");

  const tech = (await c.query("select auth_user_id from app_users where role='technician' and is_active limit 1")).rows[0]?.auth_user_id;
  await c.query("set local role authenticated");
  await as(OWNER);
  const tenant = (await c.query("select app.current_tenant_id() t")).rows[0].t;
  const cust = (await c.query("select id, phone from customers where phone is not null limit 1")).rows[0];

  console.log("▸ a customer messages the studio (webhook path)");
  const conv = await c.query(
    "insert into wa_conversations (tenant_id, phone_e164, customer_id, wa_name, last_inbound_at, unread) values ($1,'23052588854',$2,'Anesh', now(), 1) returning id",
    [tenant, cust.id],
  );
  const convId = conv.rows[0].id;
  await c.query(
    "insert into wa_messages (tenant_id, conversation_id, direction, wa_message_id, msg_type, body, status) values ($1,$2,'in','wamid.IN1','text','Can I come Saturday?','received')",
    [tenant, convId],
  );
  check("inbound message threaded", (await c.query("select count(*)::int n from wa_messages where conversation_id=$1 and direction='in'", [convId])).rows[0].n, 1);

  console.log("▸ Meta re-delivers the same webhook (dedupe)");
  try {
    await c.query("savepoint d1");
    await c.query("insert into wa_messages (tenant_id, conversation_id, direction, wa_message_id, msg_type, body) values ($1,$2,'in','wamid.IN1','text','dupe')", [tenant, convId]);
    check("duplicate wamid rejected", "allowed", "rejected");
  } catch { await c.query("rollback to savepoint d1"); check("duplicate wamid rejected", "rejected", "rejected"); }

  console.log("▸ operator replies; ticks update by wamid");
  await c.query(
    "insert into wa_messages (tenant_id, conversation_id, direction, wa_message_id, msg_type, body, status) values ($1,$2,'out','wamid.OUT1','text','Yes — 9am works.','sent')",
    [tenant, convId],
  );
  await c.query("update wa_messages set status='read' where tenant_id=$1 and wa_message_id='wamid.OUT1'", [tenant]);
  check("delivery tick applied", (await c.query("select status from wa_messages where wa_message_id='wamid.OUT1'")).rows[0].status, "read");

  console.log("▸ thread reads in order, unread clears");
  await c.query("update wa_conversations set unread=0 where id=$1", [convId]);
  check("unread cleared", (await c.query("select unread from wa_conversations where id=$1", [convId])).rows[0].unread, 0);
  check("thread has both messages", (await c.query("select count(*)::int n from wa_messages where conversation_id=$1", [convId])).rows[0].n, 2);

  console.log("▸ one conversation per number (no duplicate threads)");
  try {
    await c.query("savepoint d2");
    await c.query("insert into wa_conversations (tenant_id, phone_e164) values ($1,'23052588854')", [tenant]);
    check("duplicate thread rejected", "allowed", "rejected");
  } catch { await c.query("rollback to savepoint d2"); check("duplicate thread rejected", "rejected", "rejected"); }

  if (tech) {
    console.log("▸ RLS: a technician cannot read customer conversations");
    await as(tech);
    check("technician sees 0 conversations", (await c.query("select count(*)::int n from wa_conversations")).rows[0].n, 0);
    check("technician sees 0 messages", (await c.query("select count(*)::int n from wa_messages")).rows[0].n, 0);
    await as(OWNER);
  }

  console.log("▸ cashier (front desk) CAN operate the inbox");
  const cash = (await c.query("select auth_user_id from app_users where role='cashier' and is_active limit 1")).rows[0]?.auth_user_id;
  if (cash) {
    await as(cash);
    check("cashier sees the conversation", (await c.query("select count(*)::int n from wa_conversations")).rows[0].n, 1);
    await as(OWNER);
  } else {
    console.log("  (no cashier on file — skipped)");
  }
} catch (e) {
  failures++;
  console.error("✗ error:", e.message);
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(failures === 0 ? "\n✓ ALL CHECKS PASSED (rolled back)" : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
