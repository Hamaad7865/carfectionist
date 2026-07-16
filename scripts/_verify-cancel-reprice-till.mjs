// Dry-run for 20260716000060 (cancel_job, revision re-price, till-ceiling fix,
// Z movements) against the LIVE DB — one rolled-back transaction, nothing persists.
//
//   node scripts/_verify-cancel-reprice-till.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const __dirname = dirname(fileURLToPath(import.meta.url));
// 000060 ships together with (and its cancel path calls into) 000050 — stack both.
const migration =
  readFileSync(resolve(__dirname, "..", "supabase/migrations/20260716000050_credit_note_refund_ledger.sql"), "utf8") +
  "\n" +
  readFileSync(resolve(__dirname, "..", "supabase/migrations/20260716000060_cancel_reprice_tillfix.sql"), "utf8");
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
  try { await c.query(sql, params); check(name, false, "no error raised"); }
  catch (e) { check(name, e.message.includes(needle), e.message.slice(0, 100)); }
  await c.query("rollback to savepoint exp");
};
const doc = async (id) =>
  (await c.query(`select status, number, amount_paid, total_incl, void_reason from public.documents where id=$1`, [id])).rows[0];
const drawerCash = async (till) =>
  Number((await c.query(`select coalesce(sum(amount),0) s from public.payments where booked_session_id=$1 and method='cash'`, [till])).rows[0].s);

// quote -> job -> issued bill (unit_price 500 excl, 15% VAT = 575) on [till]; optional cash deposit.
async function jobWithBill(pair, till, tag, depositRupees) {
  const qid = randomUUID();
  await c.query(`select public.save_draft($1::jsonb,$2::jsonb,null)`, [
    JSON.stringify({ id: qid, doc_type: "quote", customer_id: pair.customer_id, vehicle_id: pair.vehicle_id, origin: "standalone" }),
    JSON.stringify([{ product_id: null, title: `Dry-run ${tag}`, qty: 1, unit_price: 500, discount_pct: 0, vat_rate: 15, sort_order: 0 }]),
  ]);
  const job = (await c.query(`select id from public.convert_quote_to_job($1, null, null, null)`, [qid])).rows[0];
  const inv = (await c.query(`select id from public.convert_quote_to_invoice($1)`, [qid])).rows[0];
  await c.query(`select public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => $3)`,
    [inv.id, `crt:${tag}:issue`, till]);
  let payId = null;
  if (depositRupees) {
    payId = (await c.query(
      `select id from public.record_payment($1,'cash',$2,$2,null,$3,null,$4)`,
      [inv.id, depositRupees, till, `crt:${tag}:dep`])).rows[0].id;
  }
  return { quoteId: qid, jobId: job.id, invId: inv.id, payId };
}

try {
  await c.query("begin");
  await c.query(migration);
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: OWNER_AUTH_UID, role: "authenticated" })]);
  const tenant = (await c.query(`select app.current_tenant_id() t`)).rows[0].t;
  await c.query(`update public.trading_days set status='open' where tenant_id=$1 and business_date=app.mu_today() and status='closed'`, [tenant]);
  const pair = (await c.query(`
    select customer_id, vehicle_id from public.documents
     where doc_type='quote' and customer_id is not null and vehicle_id is not null limit 1`)).rows[0];
  if (!pair) { console.log("⚠ no quote with customer+vehicle to borrow a pair from"); process.exit(1); }
  const till = (await c.query(`select (public.open_cash_session('crt-dryrun', 0)).id`)).rows[0].id;

  // ── revision re-price with a deposit ──────────────────────────────────────
  console.log("— revision re-price carries the deposit —");
  const a = await jobWithBill(pair, till, "a", 100);
  const cashAfterDeposit = await drawerCash(till);
  const rev = (await c.query(`select id, source_document_id, job_id from public.revise_quote($1)`, [a.quoteId])).rows[0];
  check("revision draft carries lineage (source + job)", rev.source_document_id === a.quoteId && rev.job_id === a.jobId);
  // re-price: 800 excl -> 920 incl
  await c.query(`select public.save_draft($1::jsonb,$2::jsonb,null)`, [
    JSON.stringify({ id: rev.id, doc_type: "quote", customer_id: pair.customer_id, vehicle_id: pair.vehicle_id, origin: "standalone" }),
    JSON.stringify([{ product_id: null, title: "Dry-run a REV", qty: 1, unit_price: 800, discount_pct: 0, vat_rate: 15, sort_order: 0 }]),
  ]);
  const job2 = (await c.query(`select id from public.convert_quote_to_job($1, null, null, null)`, [rev.id])).rows[0];
  check("revision accepted against the SAME job", job2.id === a.jobId);
  const oldInv = await doc(a.invId);
  check("old bill voided as re-priced, deposit walked off it",
    oldInv.status === "void" && Number(oldInv.amount_paid) === 0 && /Re-priced/.test(oldInv.void_reason ?? ""),
    `${oldInv.status} / paid ${oldInv.amount_paid} / ${oldInv.void_reason}`);
  const newInv = (await c.query(`
    select id, number, status, amount_paid, total_incl from public.documents
     where tenant_id=$1 and job_id=$2 and doc_type='invoice' and status <> 'void'`, [tenant, a.jobId])).rows[0];
  check("new bill issued from the revision at the NEW price with the deposit ON it",
    newInv && newInv.status === "partly_paid" && Number(newInv.amount_paid) === 100 && Number(newInv.total_incl) === 920,
    newInv ? `${newInv.number}: ${newInv.status}, paid ${newInv.amount_paid} of ${newInv.total_incl}` : "no live invoice");
  const transfers = (await c.query(`
    select document_id, amount, booked_session_id from public.payments
     where external_ref in ('moved to revised bill') or external_ref like 'deposit from %'`)).rows;
  check("transfer legs are paired and booked to NO session (no drawer/Z impact)",
    transfers.length === 2 && transfers.every((t) => t.booked_session_id === null) &&
    transfers.reduce((s, t) => s + Number(t.amount), 0) === 0, JSON.stringify(transfers.map(t => t.amount)));
  check("drawer cash unchanged by the transfer", (await drawerCash(till)) === cashAfterDeposit);

  // ── cancel_job ────────────────────────────────────────────────────────────
  console.log("— cancel_job resolves the money —");
  const b = await jobWithBill(pair, till, "b", 100);
  const cashBeforeCancel = await drawerCash(till);
  await c.query(`select public.cancel_job($1, 'customer changed their mind', false, $2)`, [b.jobId, till]);
  check("job cancelled", (await c.query(`select status from public.jobs where id=$1`, [b.jobId])).rows[0].status === "cancelled");
  const cn = (await c.query(`
    select id from public.documents where doc_type='credit_note' and source_document_id=$1 and status<>'void'`, [b.invId])).rows[0];
  check("deposited bill got a credit note", !!cn);
  check("the deposit came back OUT of the drawer", (await drawerCash(till)) === cashBeforeCancel - 100,
    `${cashBeforeCancel} → ${await drawerCash(till)}`);
  check("cancel twice: idempotent no-op",
    (await c.query(`select status from (select public.cancel_job($1,'again',false,$2) j) x, lateral (select (x.j).status status) s`, [b.jobId, till])).rows[0].status === "cancelled");

  const d = await jobWithBill(pair, till, "d", null); // billed, unpaid
  await c.query(`select public.cancel_job($1, 'no show', true, null)`, [d.jobId]);
  check("unpaid bill of a cancelled job is VOIDED", (await doc(d.invId)).status === "void");
  await expectError("a reason is required", `select public.cancel_job($1, '  ', true, null)`, [d.jobId], "reason is required");

  // ── till ceiling + Z movements ────────────────────────────────────────────
  console.log("— cash-out ceiling (booked axis) + Z movements —");
  const drawerNow = await drawerCash(till); // float 0 + booked cash
  await c.query(`select public.record_till_cash_out($1, $2, 'dry-run petty cash', 'crt:out1')`, [till, drawerNow - 50]);
  await expectError("cannot take more than the BOOKED drawer holds",
    `select public.record_till_cash_out($1, 100, 'too much', 'crt:out2')`, [till, ], "is in the drawer");
  const z = (await c.query(`select app.z_totals($1, $2, null, now() + interval '1 second') z`, [tenant, till])).rows[0].z;
  check("Z now carries the movements block", z.movements && z.movements.count === 1 && Number(z.movements.total) === -(drawerNow - 50),
    JSON.stringify(z.movements));

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
