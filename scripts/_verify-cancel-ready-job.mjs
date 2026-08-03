// Regression test for 20260803000030 (a ready job can still be cancelled) against the
// LIVE DB — one rolled-back transaction, nothing persists.
//
//   node scripts/_verify-cancel-ready-job.mjs
//
// 'ready' used to be a one-way door (ready → delivered only), so cancel_job refused a job
// marked ready by mistake. Voiding its bill didn't help: a ready job with an accepted quote
// is re-billed the next time checkout opens it, so the invoice came straight back under a
// new number and the void looked ignored. Vikram Budree's ALLION ran INV-0054 → 0061 →
// 0062 → 0064 that way. These checks pin the exit shut behind the correction.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
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
  catch (e) { check(name, e.message.includes(needle), e.message.slice(0, 90)); }
  await c.query("rollback to savepoint exp");
};
const job = async (id) =>
  (await c.query(`select status::text, cancel_reason from public.jobs where id=$1`, [id])).rows[0];
const liveBill = async (jobId) => (await c.query(
  `select number, status::text from public.documents
    where job_id=$1 and doc_type='invoice' and status <> 'void'`, [jobId])).rows[0];

// A quote the customer accepted → its job → its issued, unpaid bill → marked ready.
// That is precisely the shape Vikram Budree's ALLION was in.
async function readyJobWithBill(pair, tag) {
  const qid = randomUUID();
  await c.query(`select public.save_draft($1::jsonb,$2::jsonb,null)`, [
    JSON.stringify({ id: qid, doc_type: "quote", customer_id: pair.customer_id, vehicle_id: pair.vehicle_id, origin: "standalone" }),
    JSON.stringify([{ product_id: null, title: `Ready-cancel dry-run ${tag}`, qty: 1, unit_price: 500, discount_pct: 0, vat_rate: 15, sort_order: 0 }]),
  ]);
  const j = (await c.query(`select id from public.convert_quote_to_job($1, null, null, null)`, [qid])).rows[0];
  const inv = (await c.query(`select id from public.convert_quote_to_invoice($1)`, [qid])).rows[0];
  await c.query(`select public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => null)`,
    [inv.id, `rcj:${tag}:issue`]);
  await c.query(`update public.jobs set status='ready' where id=$1`, [j.id]);
  return { quoteId: qid, jobId: j.id, invId: inv.id };
}

try {
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: OWNER_AUTH_UID, role: "authenticated" })]);
  const tenant = (await c.query(`select app.current_tenant_id() t`)).rows[0].t;
  await c.query(`update public.trading_days set status='open' where tenant_id=$1 and business_date=app.mu_today() and status='closed'`, [tenant]);
  const pair = (await c.query(`
    select customer_id, vehicle_id from public.documents
     where doc_type='quote' and customer_id is not null and vehicle_id is not null limit 1`)).rows[0];
  if (!pair) { console.log("⚠ no quote with customer+vehicle to borrow a pair from"); process.exit(1); }

  // ── why voiding alone was never enough ──────────────────────────────────────
  // Still true by design, and the reason the trap hurt: re-billing is what stops a
  // void from permanently blocking a job. It is safe only because the job can now
  // be cancelled instead of left ready.
  console.log("— a bill voided under a job left READY comes back (by design) —");
  const trap = await readyJobWithBill(pair, "trap");
  const firstBill = await liveBill(trap.jobId);
  await c.query(`select public.void_document($1, 'it was a quotation')`, [trap.invId]);
  check("voiding the bill leaves no live bill…", !(await liveBill(trap.jobId)));
  check("…but the job is still ready, still demanding one", (await job(trap.jobId)).status === "ready");
  const reborn = (await c.query(`select id from public.convert_quote_to_invoice($1)`, [trap.quoteId])).rows[0];
  await c.query(`select public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => null)`,
    [reborn.id, `rcj:trap:reissue`]);
  const secondBill = await liveBill(trap.jobId);
  check("checkout re-mints it under a NEW number — the void looks ignored",
    !!secondBill && secondBill.number !== firstBill.number, `${firstBill.number} → ${secondBill?.number}`);

  // ── the correction ──────────────────────────────────────────────────────────
  console.log("\n— cancelling a ready job resolves the paperwork in one stroke —");
  const fix = await readyJobWithBill(pair, "fix");
  await c.query(`select public.cancel_job($1, 'marked ready by mistake', true, null)`, [fix.jobId]);
  const after = await job(fix.jobId);
  check("job is cancelled", after.status === "cancelled", after.status);
  check("the reason is kept for the owner to read", after.cancel_reason === "marked ready by mistake", after.cancel_reason ?? "none");
  check("its bill is voided", !(await liveBill(fix.jobId)));
  const voided = (await c.query(`select status::text, void_reason from public.documents where id=$1`, [fix.invId])).rows[0];
  check("  the void reason names the cancellation", voided.status === "void" && /Job cancelled/.test(voided.void_reason ?? ""),
    `${voided.status} / ${voided.void_reason}`);
  const q = (await c.query(`select status::text from public.documents where id=$1`, [fix.quoteId])).rows[0];
  check("the accepted quote is voided too — nothing still offers this as live work", q.status === "void", q.status);
  check("checkout's TO COLLECT list no longer returns it", (await c.query(`
    select 1 from public.documents where job_id=$1 and doc_type='invoice'
     and status in ('issued','partly_paid') and (total_incl - amount_paid) > 0`, [fix.jobId])).rowCount === 0);
  check("audit trail records the cancellation", (await c.query(
    `select 1 from public.audit_events where event_type='job_cancelled' and ref_id=$1`, [fix.jobId])).rowCount === 1);
  await c.query(`select public.cancel_job($1, 'again', true, null)`, [fix.jobId]);
  check("cancel twice: idempotent no-op", (await job(fix.jobId)).status === "cancelled");

  // The whole point of the fix: the loop must not restart afterwards.
  await expectError("and the bill CANNOT be re-minted onto a cancelled job — the loop ends",
    `select public.convert_quote_to_invoice($1)`, [fix.quoteId], "");

  // ── the one-way door that must stay shut ────────────────────────────────────
  console.log("\n— delivered is still final —");
  const gone = await readyJobWithBill(pair, "gone");
  await c.query(`update public.jobs set status='delivered' where id=$1`, [gone.jobId]);
  await expectError("a delivered job still cannot be cancelled — the car has left",
    `select public.cancel_job($1, 'too late', true, null)`, [gone.jobId], "cannot be cancelled");
  await expectError("and delivered → cancelled is still an illegal transition",
    `update public.jobs set status='cancelled' where id=$1`, [gone.jobId], "illegal job transition");
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(ok ? "\n✓ all checks passed (rolled back — nothing persisted)" : "\n✗ FAILURES above (rolled back)");
process.exit(ok ? 0 : 1);
