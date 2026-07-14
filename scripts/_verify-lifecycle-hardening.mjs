// Rolled-back verification for 20260714000002_lifecycle_hardening.sql.
// Applies the migration INSIDE a transaction, exercises every fix, ROLLS BACK.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh
let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260714000002_lifecycle_hardening.sql"), "utf8");
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
const as = (uid) => c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);

try {
  await c.query("begin");
  console.log("▸ apply migration inside the transaction");
  await c.query(migration);

  // roles for the trigger tests
  const tech = (await c.query("select auth_user_id from app_users where role='technician' and is_active limit 1")).rows[0]?.auth_user_id;
  await c.query("set local role authenticated");
  await as(OWNER);
  const tenant = (await c.query("select app.current_tenant_id() t")).rows[0].t;
  // a REAL matching pair — create_intake_quote enforces vehicle∈customer
  const pair = (await c.query("select v.id as veh, v.customer_id as cust from vehicles v where v.customer_id is not null limit 1")).rows[0];
  const cust = pair.cust, veh = pair.veh;

  console.log("▸ 5) direct client writes are closed");
  try { await c.query("savepoint g1"); await c.query("insert into documents (tenant_id, doc_type, status, customer_id) values ($1,'invoice','draft',$2)", [tenant, cust]); check("documents INSERT denied", "allowed", "denied"); }
  catch { await c.query("rollback to savepoint g1"); check("documents INSERT denied", "denied", "denied"); }
  try { await c.query("savepoint g2"); await c.query("update cash_sessions set variance = 0 where true"); check("cash_sessions UPDATE denied", "allowed", "denied"); }
  catch { await c.query("rollback to savepoint g2"); check("cash_sessions UPDATE denied", "denied", "denied"); }

  console.log("▸ build a real chain: intake-quote → accept(sign) → job ready → invoice");
  const q = await c.query(
    "select id from public.create_intake_quote($1, null, null, $2, null, null, 'Body Polish', '[]'::jsonb, '[]'::jsonb)",
    [cust, veh],
  );
  const quoteId = q.rows[0].id;
  await c.query(`select public.save_draft($1::jsonb, $2::jsonb, null)`, [
    JSON.stringify({ id: quoteId, doc_type: "quote", customer_id: cust, vehicle_id: veh }),
    JSON.stringify([{ title: "Body Polish", qty: 1, unit_price: 2000, vat_rate: 15 }]),
  ]);
  const job = await c.query("select id as job_id from public.convert_quote_to_job($1, null, null, jsonb_build_object('path','x/sig.png','name','TEST','at',now()::text))", [quoteId]);
  const jobId = job.rows[0].job_id;
  check("job created from signed quote", !!jobId, true);

  console.log("▸ 4) jobs trigger: legal + illegal transitions");
  await c.query("update jobs set status='in_progress', started_at=now() where id=$1", [jobId]);
  check("scheduled→in_progress allowed", "ok", "ok");
  try { await c.query("savepoint t1"); await c.query("update jobs set status='delivered' where id=$1", [jobId]); check("in_progress→delivered blocked", "allowed", "blocked"); }
  catch { await c.query("rollback to savepoint t1"); check("in_progress→delivered blocked", "blocked", "blocked"); }
  try { await c.query("savepoint t2"); await c.query("update jobs set customer_id=$2 where id=$1", [jobId, cust]); check("identity column change (same value) tolerated", "ok", "ok"); await c.query("release savepoint t2"); }
  catch { await c.query("rollback to savepoint t2"); check("identity column change (same value) tolerated", "blocked", "ok"); }
  await c.query("update jobs set status='ready', ready_at=now() where id=$1", [jobId]);
  check("in_progress→ready allowed", "ok", "ok");

  console.log("▸ invoice the job (via convert) + 6) second live invoice per job blocked");
  const inv = await c.query("select id from public.convert_quote_to_invoice($1)", [quoteId]);
  const invId = inv.rows[0].id;
  await c.query("select public.issue_document($1, null, 'quote-inv:' || $2)", [invId, quoteId]);
  const invRow = (await c.query("select number, total_incl, job_id from documents where id=$1", [invId])).rows[0];
  check("invoice issued + linked to job", invRow.job_id === jobId, true);
  try {
    await c.query("savepoint dup");
    const d2 = await c.query(`select id from public.save_draft($1::jsonb, $2::jsonb, null)`, [
      JSON.stringify({ doc_type: "invoice", customer_id: cust, job_id: jobId }),
      JSON.stringify([{ title: "Sneaky second bill", qty: 1, unit_price: 100, vat_rate: 15 }]),
    ]);
    await c.query("select public.issue_document($1, null, null)", [d2.rows[0].id]);
    check("second live invoice for the job blocked", "allowed", "blocked");
  } catch { await c.query("rollback to savepoint dup"); check("second live invoice for the job blocked", "blocked", "blocked"); }

  console.log("▸ 2) idempotency replay cross-check");
  try {
    await c.query("savepoint idem");
    const d3 = await c.query(`select id from public.save_draft($1::jsonb, $2::jsonb, null)`, [
      JSON.stringify({ doc_type: "quote", customer_id: cust, vehicle_id: veh }),
      JSON.stringify([{ title: "x", qty: 1, unit_price: 100, vat_rate: 15 }]),
    ]);
    await c.query("select public.issue_document($1, null, 'quote-inv:' || $2)", [d3.rows[0].id, quoteId]); // reuse foreign key on purpose
    check("replaying someone else's key rejected", "allowed", "rejected");
  } catch (e) {
    await c.query("rollback to savepoint idem");
    check("replaying someone else's key rejected", /different document/.test(e.message) ? "rejected" : `odd: ${e.message.slice(0,60)}`, "rejected");
  }

  console.log("▸ 3) pay in full → auto-deliver; reverse → back to ready");
  await c.query("select public.record_payment($1, 'cash', $2, $2, null, null, null, null)", [invId, invRow.total_incl]);
  check("job auto-delivered on full payment", (await c.query("select status from jobs where id=$1", [jobId])).rows[0].status, "delivered");
  const pay = (await c.query("select id from payments where document_id=$1 and amount > 0 limit 1", [invId])).rows[0].id;
  await c.query("select public.reverse_payment($1, 'test walk-back')", [pay]);
  check("job un-delivered on reversal", (await c.query("select status from jobs where id=$1", [jobId])).rows[0].status, "ready");
  check("un-deliver audited", (await c.query("select count(*)::int n from audit_events where event_type='job_delivery_reversed' and ref_id=$1", [jobId])).rows[0].n, 1);

  if (tech) {
    console.log("▸ 4) technician cannot deliver");
    await c.query("select public.record_payment($1, 'cash', $2, $2, null, null, null, null)", [invId, invRow.total_incl]); // re-pay → delivered again (as owner)
    await c.query("update jobs set status='ready', delivered_at=null where id=$1", [jobId]); // owner un-deliver via trigger-allowed path
    await as(tech);
    try { await c.query("savepoint t3"); await c.query("update jobs set status='delivered' where id=$1", [jobId]); check("technician delivering blocked", "allowed", "blocked"); }
    catch { await c.query("rollback to savepoint t3"); check("technician delivering blocked", "blocked", "blocked"); }
    await as(OWNER);
  }

  console.log("▸ 1) MU issue_date stamped");
  const stamped = (await c.query("select issue_date, ((issued_at at time zone 'utc') + interval '4 hours')::date as mu from documents where id=$1", [invId])).rows[0];
  check("issue_date equals MU day", String(stamped.issue_date), String(stamped.mu));
} catch (e) {
  failures++;
  console.error("✗ error:", e.message);
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(failures === 0 ? "\n✓ ALL CHECKS PASSED (rolled back)" : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
