// Dry-run for 20260716000050 (credit-note refund ledger + reversal guard) against the
// LIVE DB — one rolled-back transaction, nothing persists.
//
// Proves: a credit note on a PAID invoice books negative payment mirrors (drawer &
// Z see the refund), the invoice stays PAID, the original payment reads "already
// reversed", pre-migration credit notes are covered by the explicit guard, and a
// cash refund without an open till is refused.
//
//   node scripts/_verify-credit-note-refund.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(__dirname, "..", "supabase/migrations/20260716000050_credit_note_refund_ledger.sql"), "utf8");
const OWNER_AUTH_UID = "0eb870dc-ef5b-400a-8744-859c999a1b1b";

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

// Build + fully pay a fresh throwaway invoice on [till]; returns {invId, payId, total}.
async function paidInvoice(customerId, till, tag) {
  const invId = randomUUID();
  await c.query(`select public.save_draft($1::jsonb,$2::jsonb,null)`, [
    JSON.stringify({ id: invId, doc_type: "invoice", customer_id: customerId, origin: "standalone" }),
    JSON.stringify([{ product_id: null, title: `Dry-run ${tag}`, qty: 1, unit_price: 500, discount_pct: 0, vat_rate: 15, sort_order: 0 }]),
  ]);
  const issued = (await c.query(
    `select total_incl from public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => $3)`,
    [invId, `cnr:${tag}:issue`, till])).rows[0];
  const pay = (await c.query(
    `select id from public.record_payment($1,'cash',$2,$2,null,$3,null,$4)`,
    [invId, issued.total_incl, till, `cnr:${tag}:pay`])).rows[0];
  return { invId, payId: pay.id, total: issued.total_incl };
}
const drawerCash = async (till) =>
  (await c.query(`select coalesce(sum(amount),0) s from public.payments where booked_session_id=$1 and method='cash'`, [till])).rows[0].s;

try {
  await c.query("begin");
  await c.query(migration);
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: OWNER_AUTH_UID, role: "authenticated" }),
  ]);
  const tenant = (await c.query(`select app.current_tenant_id() t`)).rows[0].t;
  await c.query(`update public.trading_days set status='open' where tenant_id=$1 and business_date=app.mu_today() and status='closed'`, [tenant]);
  const customer = (await c.query(`select id from public.customers where tenant_id=$1 limit 1`, [tenant])).rows[0].id;
  const till = (await c.query(`select (public.open_cash_session('cnr-dryrun', 0)).id`)).rows[0].id;

  // ── the booked refund ─────────────────────────────────────────────────────
  console.log("— credit-note refund is booked —");
  const a = await paidInvoice(customer, till, "a");
  const cashBefore = await drawerCash(till);
  const cn = (await c.query(
    `select id, number from public.create_and_issue_credit_note($1, null, false, $2)`,
    [a.invId, till])).rows[0];
  check("credit note issued", !!cn.number, cn.number);
  const mirror = (await c.query(
    `select method, amount, reverses_payment_id, booked_session_id from public.payments where document_id=$1`,
    [cn.id])).rows;
  check("ONE negative mirror on the CN, reversing the original, booked to the till",
    mirror.length === 1 && Number(mirror[0].amount) === -Number(a.total) &&
    mirror[0].reverses_payment_id === a.payId && mirror[0].booked_session_id === till,
    JSON.stringify(mirror));
  const inv = (await c.query(`select status, amount_paid from public.documents where id=$1`, [a.invId])).rows[0];
  check("the invoice STAYS paid (CN is the fiscal reversal)", inv.status === "paid" && Number(inv.amount_paid) === Number(a.total));
  const cashAfter = await drawerCash(till);
  check("the drawer's cash drops by the refund", Number(cashAfter) === Number(cashBefore) - Number(a.total),
    `${cashBefore} → ${cashAfter}`);
  await expectError("reversing the refunded payment is refused (already reversed)",
    `select public.reverse_payment($1,'test',null)`, [a.payId], "already reversed");

  // ── pre-migration credit notes: the explicit guard ────────────────────────
  console.log("— guard for OLD credit notes (no mirrors) —");
  const b = await paidInvoice(customer, till, "b");
  // Simulate a credit note issued BEFORE this migration (fiscal doc, no mirrors):
  // payments are append-only, so build the bare CN row directly (service-role hat).
  await c.query(`select set_config('request.jwt.claims', '', true)`);
  await c.query(
    `insert into public.documents (tenant_id, doc_type, status, number, customer_id, source_document_id, origin, issued_at)
     values ($1, 'credit_note', 'issued', 'CN-DRYRUN', $2, $3, 'standalone', now())`,
    [tenant, customer, b.invId]);
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: OWNER_AUTH_UID, role: "authenticated" })]);
  await expectError("reversing a payment on a credit-noted invoice is refused",
    `select public.reverse_payment($1,'test',null)`, [b.payId], "has a credit note");

  // ── cash refund needs a drawer ────────────────────────────────────────────
  console.log("— cash refund without an open till —");
  const d = await paidInvoice(customer, till, "d");
  await c.query(`select set_config('request.jwt.claims', '', true)`);
  await c.query(`update public.cash_sessions set status='closed' where id=$1`, [till]);
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: OWNER_AUTH_UID, role: "authenticated" })]);
  await expectError("refused: nowhere for the cash to come out of",
    `select public.create_and_issue_credit_note($1, null, false, null)`, [d.invId], "needs an open till");

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
