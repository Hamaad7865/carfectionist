// Proves a deposit / part payment against a job's invoice: any amount up to the balance,
// the invoice goes partly_paid, the remainder stays owed, the job stays ready until the
// bill is fully settled, then delivers — and an overpayment is refused.
// Runs inside a transaction and ROLLS BACK — nothing here survives.
//   node scripts/_verify-part-payment.mjs
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b";
requireEnv("SUPABASE_DB_URL", DB_URL);

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
await c.query("begin");

const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };
const rupees = (v) => Number(v);

try {
  await c.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: OWNER, role: "authenticated" }),
  ]);

  const { rows: [ref] } = await c.query(
    `select c.id as customer_id, v.id as vehicle_id,
            (select id from products where is_active and selling_price > 0 order by name limit 1) as p
       from customers c join vehicles v on v.customer_id = c.id limit 1`,
  );

  // A quote → job → issued invoice for Rs 1,000 + VAT = Rs 1,150.
  const { rows: [q] } = await c.query(
    `select (save_draft(
       jsonb_build_object('doc_type','quote','customer_id',$1::text,'vehicle_id',$2::text),
       jsonb_build_array(jsonb_build_object(
         'product_id',$3::text,'title','The work','qty',1,'unit_price',1000::numeric,
         'discount_pct',0,'vat_rate',15,'sort_order',0)))).id::text as id`,
    [ref.customer_id, ref.vehicle_id, ref.p],
  );
  await c.query("select issue_document(p_document_id => $1, p_idempotency_key => $2)", [q.id, `v:${q.id}`]);
  const { rows: [job] } = await c.query("select (convert_quote_to_job($1, null, null)).id::text as id", [q.id]);
  await c.query("update jobs set status = 'ready', started_at = now() where id = $1", [job.id]);
  const { rows: [inv] } = await c.query("select (create_document_from_job($1,'invoice')).id::text as id", [job.id]);
  await c.query("select issue_document(p_document_id => $1, p_idempotency_key => $2)", [inv.id, `inv:${inv.id}`]);
  const total = rupees((await c.query("select total_incl from documents where id=$1", [inv.id])).rows[0].total_incl);
  ok(total === 1150, `invoice total is Rs ${total}, expected 1150`);

  // ── the deposit: Rs 400 by bank transfer (no till needed) ─────────────────
  await c.query(
    "select record_payment(p_invoice_id => $1, p_method => 'bank_transfer', p_amount => 400, p_external_ref => 'DEP-1')",
    [inv.id],
  );
  const afterDeposit = (await c.query("select status, amount_paid from documents where id=$1", [inv.id])).rows[0];
  ok(afterDeposit.status === "partly_paid", `after a deposit the invoice is ${afterDeposit.status}, expected partly_paid`);
  ok(rupees(afterDeposit.amount_paid) === 400, `paid so far Rs ${afterDeposit.amount_paid}, expected 400`);

  const jobAfterDeposit = (await c.query("select status from jobs where id=$1", [job.id])).rows[0];
  ok(jobAfterDeposit.status === "ready", `the job delivered on a mere deposit (status ${jobAfterDeposit.status}) — it must wait for full payment`);

  // ── overpayment refused ───────────────────────────────────────────────────
  let overRefused = false;
  await c.query("savepoint p1");
  try {
    await c.query("select record_payment(p_invoice_id => $1, p_method => 'bank_transfer', p_amount => 1000, p_external_ref => 'OVER')", [inv.id]);
  } catch (e) {
    overRefused = /exceeds outstanding/i.test(e.message);
  }
  await c.query("rollback to savepoint p1");
  ok(overRefused, "an overpayment past the balance was allowed");

  // ── the balance, settled — and the job delivers itself ────────────────────
  const balance = total - 400; // 750
  await c.query(
    "select record_payment(p_invoice_id => $1, p_method => 'card', p_amount => $2, p_external_ref => 'BAL-1')",
    [inv.id, balance],
  );
  const settled = (await c.query("select status, amount_paid from documents where id=$1", [inv.id])).rows[0];
  ok(settled.status === "paid", `after the balance the invoice is ${settled.status}, expected paid`);
  ok(rupees(settled.amount_paid) === total, `paid Rs ${settled.amount_paid}, expected ${total}`);

  const jobDone = (await c.query("select status, delivered_at is not null as delivered from jobs where id=$1", [job.id])).rows[0];
  ok(jobDone.status === "delivered", `the fully-paid job is ${jobDone.status}, expected delivered`);
  ok(jobDone.delivered, "the delivered job has no delivered_at stamp");

  console.log(`invoice        : Rs ${total} incl`);
  console.log(`deposit Rs 400 → ${afterDeposit.status}, job still ${jobAfterDeposit.status}`);
  console.log(`overpayment    : ${overRefused ? "refused" : "ALLOWED"}`);
  console.log(`balance Rs ${balance} → ${settled.status}, job ${jobDone.status}`);

  if (fail.length) {
    console.log("\n✗ FAILED:\n  - " + fail.join("\n  - "));
    process.exitCode = 1;
  } else {
    console.log("\n✓ A deposit leaves the bill partly paid and the job open; the balance settles it and the car is delivered; an overpayment is refused.");
  }
} catch (e) {
  console.error("✗ error:", e.message);
  process.exitCode = 1;
} finally {
  await c.query("rollback");
  await c.end();
  console.log("(rolled back — nothing kept)");
}
