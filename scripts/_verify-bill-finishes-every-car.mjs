// Verifies 20260906000010_a_bill_finishes_every_car.sql against the LIVE DB, all inside
// ONE BEGIN/ROLLBACK. Nothing survives: not the migration, not a row, not a payment.
//
// It REPRODUCES both faults before loading the fix, because a test that only shows the
// fixed behaviour cannot tell you the bug was ever real:
//
//   A. BEFORE — one bill covering three cars is paid in full, and only ONE car is
//      delivered. The other two sit at 'ready' with the money already taken.
//   B. BEFORE — the board's "hand it back" button (deliver_paid_job) tells car three
//      "the job has no invoice, bill it first" about a bill already paid in full.
//   C. NOT A BUG, pinned so nobody hunts it again — "bill this car" on car two hands
//      back the SAME invoice, never a second one: create_document_from_job delegates to
//      convert_quote_to_invoice, which is idempotent per quote, and the three cars of a
//      visit share one quote.
//   D. AFTER  — paying delivers ALL THREE, and the board can hand back car three.
//   E. AFTER  — the ordinary one-car sale is unchanged.
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import pg from "pg";
config({ path: ".env" });

const TENANT = "11111111-1111-4111-8111-000000000001";
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b";
const MIGRATION = "supabase/migrations/20260906000010_a_bill_finishes_every_car.sql";
let APP_USER;

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL.trim(), ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};
const asOwner = () =>
  c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" })]);

/** A whole visit: customer, cars, a quote covering them, the jobs, the bill — issued. */
async function aVisit(plates, label) {
  const { rows: [cust] } = await c.query(
    `insert into public.customers (tenant_id, name) values ($1, $2) returning id`, [TENANT, `ZZ Probe ${label}`]);
  const cars = [];
  for (const plate of plates) {
    const { rows: [v] } = await c.query(
      `insert into public.vehicles (tenant_id, customer_id, plate, make) values ($1,$2,$3,'Probe') returning id`,
      [TENANT, cust.id, plate]);
    cars.push(v.id);
  }
  const lines = cars.map((v, i) => ({
    title: `Detail ${i + 1}`, qty: 1, unit_price: 1000, vat_rate: 15, sort_order: i,
    line_kind: "service", vehicle_id: v,
  }));
  const { rows: [q] } = await c.query(
    `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "quote", customer_id: cust.id }), JSON.stringify(lines)]);
  const { rows: jobs } = await c.query(
    `select * from public.convert_quote_to_jobs($1, null, null, null)`, [q.id]);
  // The work is done and the cars are ready to hand back.
  await c.query(`update public.jobs set status = 'ready', ready_at = now() where source_quote_id = $1`, [q.id]);
  const { rows: [inv] } = await c.query(`select * from public.convert_quote_to_invoice($1)`, [q.id]);
  const { rows: [issued] } = await c.query(
    `select * from public.issue_document($1, null, $2, null)`, [inv.id, `probe:${inv.id}`]);
  return { cust, cars, quote: q, jobs, invoice: issued };
}

/** An open till to take the money on — record_payment refuses a payment without one. */
async function openTill() {
  const { rows: [d] } = await c.query(
    `insert into public.trading_days (tenant_id, business_date, status)
     values ($1, ((now() at time zone 'utc') + interval '4 hours')::date, 'open')
     on conflict (tenant_id, business_date) do update set status = trading_days.status
     returning id`, [TENANT]);
  const { rows: [s] } = await c.query(
    `insert into public.cash_sessions (tenant_id, device_id, trading_day_id, opened_by, opening_float, status)
     values ($1, 'ZZ-PROBE', $2, $3, 0, 'open') returning id`, [TENANT, d.id, APP_USER]);
  return s.id;
}

const statuses = async (quoteId) =>
  (await c.query(
    `select v.plate, j.status from public.jobs j join public.vehicles v on v.id = j.vehicle_id
      where j.source_quote_id = $1 order by v.plate`, [quoteId])).rows;

try {
  ({ rows: [{ id: APP_USER }] } = await c.query(
    `select id from public.app_users where tenant_id = $1 and role = 'owner' limit 1`, [TENANT]));

  await c.query("begin");
  await asOwner();
  const till = await openTill();

  // ── A + B: the faults, on the code that is live right now ────────────────
  const before = await aVisit(["ZZ BUG 1", "ZZ BUG 2", "ZZ BUG 3"], "before");
  await c.query(
    `select * from public.record_payment($1, 'cash', $2, $2, null, $3, null, $4)`,
    [before.invoice.id, before.invoice.total_incl, till, `probe-pay:${before.invoice.id}`]);
  const beforeRows = await statuses(before.quote.id);
  const deliveredBefore = beforeRows.filter((r) => r.status === "delivered").length;
  check("A the bug is real — a paid three-car bill delivers only ONE car",
    deliveredBefore === 1, `${deliveredBefore} of 3 delivered: ${JSON.stringify(beforeRows)}`);

  // B — the board's hand-back button, on a car the bill does not name in job_id
  const car3Job = before.jobs.find((j) => j.vehicle_id === before.cars[2]);
  let handBack = null;
  await c.query(`savepoint sp_hb`);
  try {
    await c.query(`select * from public.deliver_paid_job($1)`, [car3Job.id]);
  } catch (e) { handBack = e.message; } finally { await c.query(`rollback to savepoint sp_hb`); }
  check("B the second bug is real — the board cannot hand back car three",
    !!handBack && handBack.includes("no invoice"), handBack ?? "IT WORKED (bug not reproduced)");

  // C — the double-bill that ISN'T. Pinned: it hands back the same invoice.
  const car2Job = before.jobs.find((j) => j.vehicle_id === before.cars[1]);
  let sameBill = null;
  await c.query(`savepoint sp_dbl`);
  try {
    const { rows: [dup] } = await c.query(`select * from public.create_document_from_job($1, 'invoice')`, [car2Job.id]);
    sameBill = dup?.id ?? null;
  } finally { await c.query(`rollback to savepoint sp_dbl`); }
  check("C billing car two hands back the SAME bill — never a second one",
    sameBill === before.invoice.id, sameBill === before.invoice.id ? "same invoice id" : `A DIFFERENT INVOICE: ${sameBill}`);

  // ── the fix ──────────────────────────────────────────────────────────────
  await c.query(readFileSync(MIGRATION, "utf8"));
  console.log("\n→ fix loaded inside the txn\n");

  // ── C: three cars, one payment, three cars handed back ───────────────────
  const after = await aVisit(["ZZ FIX 1", "ZZ FIX 2", "ZZ FIX 3"], "after");
  await c.query(
    `select * from public.record_payment($1, 'cash', $2, $2, null, $3, null, $4)`,
    [after.invoice.id, after.invoice.total_incl, till, `probe-pay:${after.invoice.id}`]);
  const afterRows = await statuses(after.quote.id);
  check("D1 paying the bill delivers ALL THREE cars",
    afterRows.every((r) => r.status === "delivered"), JSON.stringify(afterRows));

  const { rows: covered } = await c.query(
    `select job_id from app.invoice_jobs($1)`, [after.invoice.id]);
  check("D2 the bill knows it covers three jobs", covered.length === 3, `${covered.length}`);

  // deliver_paid_job, the board's own "hand it back" button, on the LAST car
  const { rows: fixJobs } = await c.query(
    `select id, vehicle_id, status from public.jobs where source_quote_id = $1`, [after.quote.id]);
  await c.query(`update public.jobs set status = 'ready' where id = $1`, [fixJobs[2].id]);
  const { rows: [{ deliver_paid_job: moved }] } = await c.query(
    `select * from public.deliver_paid_job($1)`, [fixJobs[2].id]);
  check("D3 the board can hand back car three — it finds the bill through the junction", moved === true, String(moved));

  // ── D: the ordinary one-car sale is untouched ────────────────────────────
  const one = await aVisit(["ZZ ONE 1"], "one car");
  await c.query(
    `select * from public.record_payment($1, 'cash', $2, $2, null, $3, null, $4)`,
    [one.invoice.id, one.invoice.total_incl, till, `probe-pay:${one.invoice.id}`]);
  const oneRows = await statuses(one.quote.id);
  check("E1 a one-car sale still pays and delivers exactly as before",
    oneRows.length === 1 && oneRows[0].status === "delivered", JSON.stringify(oneRows));

  let oneSame = null;
  await c.query(`savepoint sp_one`);
  try {
    const { rows: [again] } = await c.query(`select * from public.create_document_from_job($1, 'invoice')`, [one.jobs[0].id]);
    oneSame = again?.id ?? null;
  } finally { await c.query(`rollback to savepoint sp_one`); }
  check("E2 billing a one-car job again still hands back its own bill",
    oneSame === one.invoice.id, oneSame === one.invoice.id ? "same invoice id" : `DIFFERENT: ${oneSame}`);

  const { rows: [{ n: fns }] } = await c.query(
    `select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname='public' and p.proname in
        ('record_payment','deliver_on_account','deliver_paid_job')`);
  check("E3 no stale overloads (3 functions, 3 definitions)", fns === 3, `${fns}`);
} catch (e) {
  failed = true;
  console.error("✗ threw:", e.message);
} finally {
  await c.query("rollback");
  await c.end();
  console.log(failed ? "\n✗ FAILED — nothing was written" : "\n✓ all green — rolled back, nothing was written");
  process.exitCode = failed ? 1 : 0;
}
