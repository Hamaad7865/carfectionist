// Dry-run: split payment (multiple methods on one invoice) against the LIVE DB, inside a
// rolled-back transaction. Proves the exact behaviour the tablet's split relies on:
//   - two partial record_payment calls (juice 500 + cash 500) settle a 1000 bill to 'paid'
//   - the invoice's amount_paid == total, status 'paid'
//   - a job attached to it auto-delivers on the FINAL (closing) tender, not the first
//   - per-index idempotency keys replay (retry-safe), never double-charging
//
//   node scripts/_verify-split-payment.mjs
import pg from "pg";
import { randomUUID } from "node:crypto";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b";
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
let ok = true;
const check = (n, cond, d = "") => { console.log(`${cond ? "  ✓" : "  ✗"} ${n}${d ? ` — ${d}` : ""}`); if (!cond) ok = false; };

try {
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: OWNER, role: "authenticated" })]);
  const tenant = (await c.query(`select app.current_tenant_id() t`)).rows[0].t;
  await c.query(`update public.trading_days set status='open' where tenant_id=$1 and business_date=app.mu_today() and status='closed'`, [tenant]);
  const customer = (await c.query(`select id from public.customers where tenant_id=$1 limit 1`, [tenant])).rows[0].id;
  const till = (await c.query(`select (public.open_cash_session('split-dryrun', 0)).id`)).rows[0].id;

  // A READY job with a fresh 1000-rupee invoice, so we can watch the split deliver it.
  const pair = (await c.query(`select customer_id, vehicle_id from public.documents where doc_type='quote' and customer_id is not null and vehicle_id is not null limit 1`)).rows[0];
  const qid = randomUUID();
  await c.query(`select public.save_draft($1::jsonb,$2::jsonb,null)`, [
    JSON.stringify({ id: qid, doc_type: "quote", customer_id: pair.customer_id, vehicle_id: pair.vehicle_id, origin: "standalone" }),
    JSON.stringify([{ product_id: null, title: "Split dry-run service", qty: 1, unit_price: 869.57, discount_pct: 0, vat_rate: 15, sort_order: 0 }]), // ~1000 incl
  ]);
  const job = (await c.query(`select id from public.convert_quote_to_job($1,null,null,null)`, [qid])).rows[0].id;
  const inv = (await c.query(`select id from public.convert_quote_to_invoice($1)`, [qid])).rows[0].id;
  await c.query(`update public.jobs set status='ready' where id=$1`, [job]); // ready to be collected
  const issued = (await c.query(`select total_incl from public.issue_document(p_document_id=>$1,p_stock_location_id=>null,p_idempotency_key=>'sp:issue',p_session_id=>$2)`, [inv, till])).rows[0];
  const total = Number(issued.total_incl);
  console.log(`bill total: ${total}`);
  const half = Math.round((total / 2) * 100) / 100;
  const rest = Math.round((total - half) * 100) / 100;

  // ── the split: tender 1 (juice, partial) ──────────────────────────────────
  await c.query(`select public.record_payment($1,'juice',$2,null,'JU-1',$3,null,'sp:pay:0')`, [inv, half, till]);
  let d = (await c.query(`select status, amount_paid from public.documents where id=$1`, [inv])).rows[0];
  check("after tender 1: invoice partly_paid", d.status === "partly_paid", `${d.status}, paid ${d.amount_paid}`);
  check("job NOT delivered yet (bill not closed)", (await c.query(`select status from public.jobs where id=$1`, [job])).rows[0].status === "ready");

  // ── tender 2 (cash, closes it) ─────────────────────────────────────────────
  await c.query(`select public.record_payment($1,'cash',$2,$2,null,$3,null,'sp:pay:1')`, [inv, rest, till]);
  d = (await c.query(`select status, amount_paid from public.documents where id=$1`, [inv])).rows[0];
  check("after tender 2: invoice PAID in full", d.status === "paid" && Math.abs(Number(d.amount_paid) - total) < 0.001, `${d.status}, paid ${d.amount_paid}`);
  check("job auto-delivered on the CLOSING tender", (await c.query(`select status from public.jobs where id=$1`, [job])).rows[0].status === "delivered");

  const pays = (await c.query(`select method, amount from public.payments where document_id=$1 order by received_at`, [inv])).rows;
  check("exactly two payment rows recorded (juice + cash)", pays.length === 2 && pays.map(p=>p.method).sort().join() === "cash,juice", JSON.stringify(pays));
  check("both booked to the till (Z sees them)",
    (await c.query(`select count(*) n from public.payments where document_id=$1 and booked_session_id=$2`, [inv, till])).rows[0].n === "2");

  // ── retry safety: replaying the same keys must not double-charge ──────────
  await c.query(`select public.record_payment($1,'juice',$2,null,'JU-1',$3,null,'sp:pay:0')`, [inv, half, till]);
  await c.query(`select public.record_payment($1,'cash',$2,$2,null,$3,null,'sp:pay:1')`, [inv, rest, till]);
  check("replaying both tender keys = no new rows (idempotent)",
    (await c.query(`select count(*) n from public.payments where document_id=$1`, [inv])).rows[0].n === "2");

  await c.query("rollback");
  console.log(`\n${ok ? "PASS" : "FAIL"} — rolled back, nothing persisted.`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("✗ dry-run error:", e.message);
  process.exit(1);
} finally { await c.end(); }
