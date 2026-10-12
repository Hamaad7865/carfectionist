// Verifies 20261012000010_restore_reverse_payment_guards.sql against the LIVE database,
// entirely inside ONE BEGIN/ROLLBACK on the TEST Sandbox tenant (…0002). Nothing
// survives: not the migration, not a row, not a payment, not a document number.
//
// It REPRODUCES the faults on the code that is installed right now before it loads the
// fix, on the very same rows (each "before" runs inside a savepoint that is rolled
// back) — a test that only shows the fixed behaviour cannot say the bug was ever real:
//
//   BEFORE  A. reversing the payment that handed a car over leaves the job 'delivered'
//              against a bill that is open again (one car, and three cars on one bill).
//           B. a payment taken on an already-credited invoice can be reversed, and the
//              refunded invoice changes status under the credit note.
//           C. the function sums the payments before it locks the document.
//   AFTER   A. the reversal walks back every car that payment delivered, with an audit
//              row each — and ONLY those: a car that left on account stays delivered.
//           B. the credited invoice refuses the reversal.
//           C. the document is locked before the sum.
//           D. nothing else moved: plain reversal, points unwind, "already reversed",
//              the reason guard, the owner gate, the grants, one overload — and the
//              file is a no-op when run a second time.
//
// Once the migration is really installed, BEFORE has nothing left to reproduce and is
// skipped; AFTER still runs, so this stays a regression check.
//
//   node scripts/_verify-reverse-payment-guards.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DB_URL, requireEnv } from "./_env.mjs";
import { SANDBOX_TENANT } from "./_sandbox.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = "supabase/migrations/20261012000010_restore_reverse_payment_guards.sql";
const migration = readFileSync(resolve(__dirname, "..", MIGRATION), "utf8");
const SANDBOX_OWNER_AUTH = "b729191b-1159-4d46-88c7-3c9aceb5e664"; // TEST Sandbox (owner)

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};
const asOwner = () =>
  c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: SANDBOX_OWNER_AUTH, role: "authenticated" })]);
const asService = () => c.query(`select set_config('request.jwt.claims', '', true)`);

/** Run it, look, and put everything back — the fixtures are reused after the fix. */
const dryRun = async (fn) => {
  await c.query("savepoint dry");
  try { return await fn(); } finally { await c.query("rollback to savepoint dry"); }
};
const expectRefusal = async (name, sql, params, needle) => {
  await c.query("savepoint exp");
  let msg = null;
  try { await c.query(sql, params); } catch (e) { msg = e.message; }
  await c.query("rollback to savepoint exp");
  check(name, !!msg && msg.includes(needle), msg ? msg.slice(0, 120) : "NO ERROR WAS RAISED");
};

const liveDef = async () => (await c.query(
  `select pg_get_functiondef(p.oid) def, md5(pg_get_functiondef(p.oid)) md5, p.proacl::text acl
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reverse_payment'`)).rows;
const doc = async (id) =>
  (await c.query(`select status, amount_paid::float8 paid, total_incl::float8 total, number from public.documents where id = $1`, [id])).rows[0];
const jobsOf = async (quoteId) =>
  (await c.query(
    `select j.id, v.plate, j.status, j.delivered_at from public.jobs j join public.vehicles v on v.id = j.vehicle_id
      where j.source_quote_id = $1 order by v.plate`, [quoteId])).rows;
const walkBacks = async (quoteId) =>
  (await c.query(
    `select a.payload from public.audit_events a
      where a.event_type = 'job_delivery_reversed' and a.ref_type = 'job'
        and a.ref_id in (select id from public.jobs where source_quote_id = $1)`, [quoteId])).rows;
const reverse = (payId, reason) =>
  c.query(`select * from public.reverse_payment($1::uuid, $2::text)`, [payId, reason]);

let TILL, seq = 0;
const pay = async (invoiceId, amount, method = "card") =>
  (await c.query(
    `select * from public.record_payment($1::uuid, $2::payment_method, $3::numeric, null, $4, $5::uuid, null, $6)`,
    [invoiceId, method, amount, method === "cash" ? null : `RP-PROBE-${++seq}`, TILL, `rp-probe:pay:${++seq}`])).rows[0];

const newCustomer = async (label) =>
  (await c.query(
    `insert into public.customers (tenant_id, name, phone) values ($1, $2, $3) returning id`,
    [SANDBOX_TENANT, `ZZ Reversal Probe ${label}`, `5799${String(++seq).padStart(4, "0")}`])).rows[0].id;

/** A whole visit: customer, cars, one quote over them, a READY job per car, the bill — issued. */
async function aVisit(label, plates) {
  const cust = await newCustomer(label);
  const cars = [];
  for (const plate of plates) {
    cars.push((await c.query(
      `insert into public.vehicles (tenant_id, customer_id, plate, make) values ($1, $2, $3, 'Probe') returning id`,
      [SANDBOX_TENANT, cust, plate])).rows[0].id);
  }
  const lines = cars.map((v, i) => ({
    title: `Detail ${i + 1}`, qty: 1, unit_price: 1000, vat_rate: 15, sort_order: i,
    line_kind: "service", vehicle_id: v,
  }));
  const quote = (await c.query(`select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "quote", customer_id: cust }), JSON.stringify(lines)])).rows[0];
  await c.query(`select * from public.convert_quote_to_jobs($1, null, null, null)`, [quote.id]);
  // The work is done and the cars are waiting to be handed back.
  await c.query(`update public.jobs set status = 'ready', ready_at = now() where source_quote_id = $1`, [quote.id]);
  const draft = (await c.query(`select * from public.convert_quote_to_invoice($1)`, [quote.id])).rows[0];
  const invoice = (await c.query(`select * from public.issue_document($1, null, $2, $3)`,
    [draft.id, `rp-probe:issue:${draft.id}`, TILL])).rows[0];
  return { cust, quote, invoice };
}

/** A counter sale with no job behind it. */
async function aSale(label) {
  const cust = await newCustomer(label);
  const draft = (await c.query(`select * from public.save_draft($1::jsonb, $2::jsonb, null)`, [
    JSON.stringify({ doc_type: "invoice", customer_id: cust }),
    JSON.stringify([{ product_id: null, title: `Probe ${label}`, qty: 1, unit_price: 1000, discount_pct: 0,
      vat_rate: 15, sort_order: 0, line_kind: "product" }]),
  ])).rows[0];
  const invoice = (await c.query(`select * from public.issue_document($1, null, $2, $3)`,
    [draft.id, `rp-probe:issue:${draft.id}`, TILL])).rows[0];
  return { cust, invoice };
}

const [before] = await liveDef();
try {
  await c.query("begin");
  await asOwner();
  const tenant = (await c.query(`select app.current_tenant_id() t`)).rows[0].t;
  if (tenant !== SANDBOX_TENANT) throw new Error(`refusing to run: the impersonated user belongs to ${tenant}, not the sandbox`);

  // The sandbox collects forgotten tills; a fresh one is opened here the way a cashier
  // would. Closing the stale ones is fixture setup and rolls back with everything else.
  await asService();
  await c.query(`update public.cash_sessions set status = 'closed', closed_at = now() where tenant_id = $1 and status = 'open'`, [SANDBOX_TENANT]);
  await asOwner();
  TILL = (await c.query(`select id from public.open_cash_session($1, 0)`, [`SANDBOX-RP-${Date.now()}`])).rows[0].id;

  // ── fixtures, built through the live RPCs ─────────────────────────────────
  console.log("▸ fixtures (sandbox tenant, live RPCs)");
  const one = await aVisit("one car", ["ZZ RP 1"]);
  const payOne = await pay(one.invoice.id, one.invoice.total_incl);
  check("one car: paying the bill delivers it", (await jobsOf(one.quote.id)).every((j) => j.status === "delivered"));

  const three = await aVisit("three cars", ["ZZ RP 2", "ZZ RP 3", "ZZ RP 4"]);
  const payThree = await pay(three.invoice.id, three.invoice.total_incl);
  check("three cars on one bill: paying it delivers all three",
    (await jobsOf(three.quote.id)).filter((j) => j.status === "delivered").length === 3);

  // A car that left ON ACCOUNT an hour ago and is paid for now. Every row in this
  // transaction shares one now(), which would fool the discriminator's equality — so
  // the handover is moved back, as the passage of real time would have.
  const acct = await aVisit("on account", ["ZZ RP 5"]);
  await c.query(`select public.deliver_on_account($1)`, [acct.invoice.id]);
  await c.query(`update public.jobs set delivered_at = delivered_at - interval '1 hour' where source_quote_id = $1`, [acct.quote.id]);
  const payAcct = await pay(acct.invoice.id, acct.invoice.total_incl);
  check("on account: the car was already delivered before the money came", (await jobsOf(acct.quote.id))[0].status === "delivered");

  // Part-paid, then credited, then paid again — every step is one the RPCs allow today.
  const credited = await aSale("credited");
  const part = await pay(credited.invoice.id, 400);
  const cn = (await c.query(`select * from public.create_and_issue_credit_note($1, null, false, $2)`, [credited.invoice.id, TILL])).rows[0];
  check("a credit note can be raised against a part-paid invoice", cn.doc_type === "credit_note" && !!cn.number, cn.number);
  check("…and the invoice is still 'partly_paid' afterwards (the credit note does not close it)",
    (await doc(credited.invoice.id)).status === "partly_paid");
  let late = null, lateErr = null;
  await c.query("savepoint late");
  try { late = await pay(credited.invoice.id, 750); } catch (e) { lateErr = e.message; await c.query("rollback to savepoint late"); }
  console.log(late
    ? "  · record_payment took Rs 750 on the credited invoice — it has no credit-note guard (the open decision)"
    : `  · record_payment refused the credited invoice: ${lateErr}`);

  const plain = await aSale("plain");
  const payPlain = await pay(plain.invoice.id, plain.invoice.total_incl, "cash");
  const gate = await aSale("owner gate");
  const payGate = await pay(gate.invoice.id, gate.invoice.total_incl);

  // ── BEFORE: the faults, on what is installed right now ────────────────────
  const installed = /this invoice has a credit note/.test(before.def) && /job_delivery_reversed/.test(before.def);
  if (installed) {
    console.log("\n▸ BEFORE — skipped: the guards are already installed, there is nothing left to reproduce");
  } else {
    console.log("\n▸ BEFORE — the faults are real (each run is rolled back to here)");
    await dryRun(async () => {
      await reverse(payOne.id, "probe: wrong bill");
      const j = await jobsOf(one.quote.id);
      check("A. the bill is open again…", (await doc(one.invoice.id)).status === "issued");
      check("A. …and the car is STILL 'delivered' — the walk-back is missing", j[0].status === "delivered", `job ${j[0].status}`);
    });
    await dryRun(async () => {
      await reverse(payThree.id, "probe: wrong bill");
      const n = (await jobsOf(three.quote.id)).filter((j) => j.status === "delivered").length;
      check("A. three cars: all three STILL 'delivered' after the reversal", n === 3, `${n} of 3 delivered`);
    });
    if (late) {
      await dryRun(async () => {
        const was = (await doc(credited.invoice.id)).status;
        let err = null;
        await c.query("savepoint b");
        try { await reverse(late.id, "probe: money taken on a credited bill"); }
        catch (e) { err = e.message; await c.query("rollback to savepoint b"); }
        const now = (await doc(credited.invoice.id)).status;
        check("B. a payment on a credited invoice CAN be reversed — the guard is missing", err === null, err ?? `status ${was} → ${now}`);
      });
    }
    check("C. the function sums the payments BEFORE it reads the document, and reads it unlocked",
      /into v_paid from public\.payments where document_id = v_orig\.document_id;\s*\n\s*select \* into v_doc from public\.documents where id = v_orig\.document_id;/.test(before.def));
  }

  // ── the fix ───────────────────────────────────────────────────────────────
  console.log(`\n▸ loading ${MIGRATION}`);
  await asService();
  await c.query(migration);
  const [after] = await liveDef();
  check("the migration ran and its own proof block passed", true);
  check("still exactly one reverse_payment", (await liveDef()).length === 1);
  check("the grants are untouched", after.acl === before.acl, after.acl);
  await c.query(migration);
  check("running the file a second time changes nothing", (await liveDef())[0].md5 === after.md5);
  await asOwner();

  // ── AFTER ─────────────────────────────────────────────────────────────────
  console.log("\n▸ AFTER — A. the walk-back");
  await reverse(payOne.id, "probe: wrong bill");
  const j1 = await jobsOf(one.quote.id);
  check("one car: the bill is open again", (await doc(one.invoice.id)).status === "issued");
  check("one car: the job is back to 'ready', its handover stamp cleared", j1[0].status === "ready" && j1[0].delivered_at === null, `job ${j1[0].status}`);
  const w1 = await walkBacks(one.quote.id);
  check("one car: one 'job_delivery_reversed' audit row, carrying the reason and the invoice",
    w1.length === 1 && w1[0].payload.reason === "probe: wrong bill" && w1[0].payload.invoice === one.invoice.number, JSON.stringify(w1));

  await reverse(payThree.id, "probe: wrong bill");
  const j3 = await jobsOf(three.quote.id);
  check("three cars: ALL three are back to 'ready'", j3.every((j) => j.status === "ready" && j.delivered_at === null),
    j3.map((j) => `${j.plate}=${j.status}`).join(", "));
  check("three cars: three audit rows, one per car", (await walkBacks(three.quote.id)).length === 3);

  await reverse(payAcct.id, "probe: wrong bill");
  check("on account: the bill is open again", (await doc(acct.invoice.id)).status === "issued");
  check("on account: the car STAYS delivered — this payment did not hand it over", (await jobsOf(acct.quote.id))[0].status === "delivered");
  check("on account: no walk-back was logged", (await walkBacks(acct.quote.id)).length === 0);

  console.log("\n▸ AFTER — B. the credit-note guard");
  if (late) {
    await expectRefusal("a payment on a credited invoice can no longer be reversed",
      `select public.reverse_payment($1::uuid, 'probe')`, [late.id], "this invoice has a credit note");
  }
  await expectRefusal("the payment the credit note refunded still reads 'already reversed'",
    `select public.reverse_payment($1::uuid, 'probe')`, [part.id], "payment already reversed");

  console.log("\n▸ AFTER — C. the document lock");
  check("the document is locked before the payments are summed",
    /from public\.documents where id = v_orig\.document_id for update;\s*\n\s*select coalesce\(sum\(amount\), 0\) into v_paid/.test(after.def));

  console.log("\n▸ AFTER — D. nothing else moved");
  const earned = Number((await c.query(
    `select coalesce(sum(delta), 0) s from public.customer_points_ledger where customer_id = $1 and reason = 'earned'`, [plain.cust])).rows[0].s);
  const mirror = (await reverse(payPlain.id, "probe: customer changed mind")).rows[0];
  check("a plain cash reversal books a negative mirror to the till it came out of",
    Number(mirror.amount) === -Number(payPlain.amount) && mirror.reverses_payment_id === payPlain.id && mirror.booked_session_id === TILL);
  check("…and the invoice is open again", (await doc(plain.invoice.id)).status === "issued");
  const unearned = Number((await c.query(
    `select coalesce(-sum(delta), 0) s from public.customer_points_ledger where customer_id = $1 and reason = 'reversed'`, [plain.cust])).rows[0].s);
  if (earned > 0) check("…and the points the settlement earned are taken back", unearned === earned, `${earned} earned, ${unearned} reversed`);
  else console.log("  · (this sale earned no points — the unwind call is asserted by the migration's proof block)");
  await expectRefusal("a second reversal of the same payment is refused",
    `select public.reverse_payment($1::uuid, 'probe')`, [payPlain.id], "payment already reversed");
  await expectRefusal("a reversal with no reason is refused",
    `select public.reverse_payment($1::uuid, '  ')`, [payGate.id], "a reason is required");

  await c.query("savepoint gate");
  await asService();
  await c.query(`update public.app_users set role = 'manager' where tenant_id = $1 and auth_user_id = $2`, [SANDBOX_TENANT, SANDBOX_OWNER_AUTH]);
  await asOwner();
  await expectRefusal("a manager with no owner override is refused",
    `select public.reverse_payment($1::uuid, 'probe')`, [payGate.id], "reversal requires the owner");
  await c.query("rollback to savepoint gate");
  await asOwner();
} catch (e) {
  failed = true;
  console.error(`\n✗ probe error: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  const [end] = await liveDef();
  check("ROLLED BACK — the installed function is byte-identical to how this run found it", end.md5 === before.md5, end.md5);
  await c.end();
}
console.log(`\n${failed ? "FAIL" : "PASS"} — nothing persisted.`);
process.exit(failed ? 1 : 0);
