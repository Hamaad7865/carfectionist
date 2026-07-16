// Dry-run for 20260716000040 (till gate, all methods) AND the server contracts the
// frozen-basket retry fix depends on — one rolled-back transaction, nothing persists.
//
// Proves:
//   TILL GATE: a card payment with no session is refused; with an open till it lands.
//   RETRY LEGS: save_draft upserts by caller id (retry = same draft, no orphans);
//     an issued draft re-saved says 'cannot edit an issued document' (= issue committed);
//     issue_document replays its key against the SAME id without error;
//     record_payment replays its key (same payment back), refuses a different invoice.
//
//   node scripts/_verify-settle-and-till-gate.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(__dirname, "..", "supabase/migrations/20260716000040_till_gate_all_methods.sql"), "utf8");
const OWNER_AUTH_UID = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner)

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
let ok = true;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) ok = false;
};
const expectError = async (name, sql, params, needle) => {
  await c.query("savepoint exp");
  try {
    await c.query(sql, params);
    check(name, false, "no error was raised");
  } catch (e) {
    check(name, e.message.includes(needle), e.message.slice(0, 110));
  }
  await c.query("rollback to savepoint exp");
};

try {
  await c.query("begin");
  await c.query(migration);
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: OWNER_AUTH_UID, role: "authenticated" }),
  ]);
  const tenant = (await c.query(`select app.current_tenant_id() t`)).rows[0].t;
  // Neutralise a closed trading day for the duration of this rolled-back tx.
  await c.query(`update public.trading_days set status='open' where tenant_id=$1 and business_date=app.mu_today() and status='closed'`, [tenant]);

  const inv = (await c.query(`
    select id, number, total_incl - amount_paid outstanding from public.documents
     where doc_type='invoice' and status in ('issued','partly_paid') and customer_id is not null
     order by created_at desc limit 1`)).rows[0];
  const customer = (await c.query(`select id from public.customers where tenant_id=$1 limit 1`, [tenant])).rows[0];
  if (!inv || !customer) { console.log("⚠ no open invoice / customer to test with"); process.exit(1); }

  // ── till gate ─────────────────────────────────────────────────────────────
  console.log("— till gate (all methods) —");
  await expectError("card payment with NO till is refused",
    `select public.record_payment($1,'card',0.01,null,'DRYRUN',null,null,'tg:1')`,
    [inv.id], "must be taken on an open till");
  const till = (await c.query(`select (public.open_cash_session('dryrun-device', 0)).id`)).rows[0].id;
  const p1 = (await c.query(
    `select * from public.record_payment($1,'card',0.01,null,'DRYRUN',$2,null,'tg:2')`,
    [inv.id, till])).rows[0];
  check("card payment ON an open till lands, booked to it", p1.booked_session_id === till);

  // ── retry legs ────────────────────────────────────────────────────────────
  console.log("— frozen-basket retry contracts —");
  const draftId = randomUUID();
  const doc = JSON.stringify({ id: draftId, doc_type: "invoice", customer_id: customer.id, origin: "standalone" });
  const lines = JSON.stringify([{ product_id: null, title: "Dry-run line", qty: 1, unit_price: 100, discount_pct: 0, vat_rate: 15, sort_order: 0 }]);
  const d1 = (await c.query(`select (public.save_draft($1::jsonb,$2::jsonb,null)).id`, [doc, lines])).rows[0].id;
  check("save_draft honours the caller's id", d1 === draftId);
  const d2 = (await c.query(`select (public.save_draft($1::jsonb,$2::jsonb,null)).id`, [doc, lines])).rows[0].id;
  const drafts = (await c.query(`select count(*) n from public.documents where id=$1`, [draftId])).rows[0].n;
  check("re-saving is an UPDATE of the same draft (no orphan)", d2 === draftId && drafts === "1");

  const issued = (await c.query(
    `select id, number, total_incl from public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => 'st:issue', p_session_id => $2)`,
    [draftId, till])).rows[0];
  check("draft issued (gapless number drawn)", issued.id === draftId && !!issued.number, issued.number);

  await expectError("re-saving an ISSUED draft says so (= proof the issue committed)",
    `select public.save_draft($1::jsonb,$2::jsonb,null)`, [doc, lines], "cannot edit an issued document");

  const replayIssue = (await c.query(
    `select id from public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => 'st:issue', p_session_id => $2)`,
    [draftId, till])).rows[0];
  check("issue replay under the same key + same id returns the SAME document", replayIssue.id === draftId);

  const pay = (await c.query(
    `select * from public.record_payment($1,'card',$2,null,'DRYRUN',$3,null,'st:pay')`,
    [draftId, issued.total_incl, till])).rows[0];
  const payReplay = (await c.query(
    `select * from public.record_payment($1,'card',$2,null,'DRYRUN',$3,null,'st:pay')`,
    [draftId, issued.total_incl, till])).rows[0];
  check("payment replay under the same key returns the SAME payment", pay.id === payReplay.id);
  await expectError("the key refuses a DIFFERENT invoice",
    `select public.record_payment($1,'card',0.01,null,'DRYRUN',$2,null,'st:pay')`,
    [inv.id, till], "different invoice");

  await c.query("rollback");
  console.log(`\n${ok ? "PASS" : "FAIL"} — transaction rolled back, nothing persisted.`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("✗ dry-run error:", e.message);
  process.exit(1);
} finally {
  await c.end();
}
