// Bills and settles Atish Purboo's "10 years protection (interior & exterior)" job
// on PA 427 — the Rs 69,000 that was never invoiced at all.
//
// WHAT WENT WRONG. Quote A00120 (Rs 69,000) became job 4304f3ee on 20 Aug, which
// auto-issued INV-0139. Nick voided that on 22 Aug as "duplicated inv 0139". A fresh
// invoice was drafted on 26 Aug and never issued, so the job has sat `ready` and
// unbilled ever since — no invoice for the customer to pay against.
//
// The owner confirms (CCTV) the customer paid Rs 69,000 in full by JUICE.
//
// WHAT THIS DOES — through the same RPCs the app uses, run as the owner so RLS,
// require_role and the audit actor are real:
//   1. stamp the draft with an internal note saying when the money really arrived;
//   2. issue the Rs 69,000 draft — mints the fiscal number;
//   3. record Rs 69,000 by Juice against the back-office till.
//
// The single line is a SERVICE with no product_id, so nothing moves in stock — unlike
// etienne's bill, there are no parts to restock. Verified below rather than assumed.
//
// DATING. record_payment stamps now(); there is no backdating through it, and a
// direct write would bypass the till, the amount_paid rollup and the audit. So the
// bill and the payment land on TODAY's trading day and today's Z. The 2 Sept and
// 20 Aug Z reports are frozen JSON snapshots and do not move.
//
//   node scripts/_fix-atish-payment.mjs           # dry run, rolled back
//   node scripts/_fix-atish-payment.mjs --commit  # for real
import { config } from "dotenv";
import pg from "pg";
config({ path: ".env" });

const COMMIT = process.argv.includes("--commit");
const TENANT = "11111111-1111-4111-8111-000000000001";
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh — the actor on every audit row below

const DRAFT_INVOICE = "fa6fbcd3-684d-4130-894e-be5ad5828780"; // Rs 69,000, drafted 26 Aug, never issued
const JOB           = "4304f3ee-def2-44e9-954b-6f55ee7ad5d8"; // PA 427, ready since 20 Aug
const CUSTOMER      = "fd288c0d-333c-4fc6-82f2-868464e3d026";
const SHOP          = "0a000000-0000-4000-8000-000000000002";
const AMOUNT        = 69000.0;
const METHOD        = "juice";
// Every card and Juice row in the live data carries "POS" — what the shop's own
// terminal writes. record_payment refuses these methods without a reference.
const EXTERNAL_REF  = "POS";
const NOTE = "Paid Rs 69,000 by Juice in full (confirmed on CCTV). Billed and recorded 09/09/2026 — "
           + "the job ran 20/08/2026 and INV-0139 was voided as a duplicate, leaving the work unbilled.";

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL.trim(), ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};
const movementCount = async () => {
  const { rows } = await c.query(
    `select count(*)::int n from public.stock_movements where tenant_id = $1 and ref_id = $2`, [TENANT, DRAFT_INVOICE]);
  return rows[0].n;
};

try {
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" })]);

  const { rows: [till] } = await c.query(
    `select id from public.cash_sessions
      where tenant_id = $1 and device_id = 'back-office' and status = 'open'
      order by opened_at desc limit 1`, [TENANT]);
  if (!till) throw new Error("no open back-office till — run the back_office_till RPC first");
  console.log(`→ desk till ${till.id}\n`);

  // Guard: this must still be the unbilled draft, not something that moved since.
  const { rows: [before] } = await c.query(
    `select status, total_incl, job_id, customer_id from public.documents where id = $1`, [DRAFT_INVOICE]);
  check("0 the target is still an unissued Rs 69,000 bill for this job",
    before.status === "draft" && Number(before.total_incl) === AMOUNT
      && before.job_id === JOB && before.customer_id === CUSTOMER,
    `${before.status}, Rs ${before.total_incl}`);
  if (failed) throw new Error("the draft is not what it was when this was written — re-check before running");

  // ── 1. say when the money really arrived (internal note, never on the PDF) ──
  await c.query(`update public.documents set comment = $2 where id = $1 and status = 'draft'`, [DRAFT_INVOICE, NOTE]);

  // ── 2. issue the bill ─────────────────────────────────────────────────────
  const { rows: [inv] } = await c.query(
    `select id, number, status, total_incl from public.issue_document($1, $2, $3, $4)`,
    [DRAFT_INVOICE, SHOP, "fix-atish-20260909:issue", till.id]);
  check("2 the Rs 69,000 bill is issued and numbered", inv.status === "issued" && !!inv.number,
    `${inv.number} — Rs ${inv.total_incl}`);
  check("2b it is the amount the owner confirmed", Number(inv.total_incl) === AMOUNT, `Rs ${inv.total_incl}`);
  check("2c no stock moved — the line is labour, not parts", (await movementCount()) === 0);

  // ── 3. the money ──────────────────────────────────────────────────────────
  await c.query(
    `select public.record_payment($1, $2::payment_method, $3, null, $4, $5, null, $6)`,
    [inv.id, METHOD, AMOUNT, EXTERNAL_REF, till.id, "fix-atish-20260909:collect"]);

  // ── verify the rollup actually moved, rather than trusting the call ────────
  const { rows: [after] } = await c.query(
    `select status, amount_paid, total_incl from public.documents where id = $1`, [inv.id]);
  check("3 the bill reads as paid in full", after.status === "paid" && Number(after.amount_paid) === AMOUNT,
    `${after.status}, Rs ${after.amount_paid} of ${after.total_incl}`);
  const { rows: [pay] } = await c.query(
    `select p.method, p.amount, p.cash_session_id, u.display_name taker
       from public.payments p left join public.app_users u on u.id = p.received_by
      where p.document_id = $1`, [inv.id]);
  check("3b one Juice payment, booked to the desk till",
    pay?.method === METHOD && Number(pay.amount) === AMOUNT && pay.cash_session_id === till.id,
    `${pay?.method} Rs ${pay?.amount} by ${pay?.taker}`);
  const { rows: [job] } = await c.query(`select status, delivered_at from public.jobs where id = $1`, [JOB]);
  check("3c the car is marked handed over", job.status === "delivered" && !!job.delivered_at, job.status);

  // His other two bills were already settled; nothing of his may be left owing.
  const { rows: [{ n: owing }] } = await c.query(
    `select count(*)::int n from public.documents
      where customer_id = $1 and doc_type = 'invoice' and status not in ('void','draft')
        and coalesce(amount_paid, 0) < total_incl`, [CUSTOMER]);
  check("4 nothing of his is still outstanding", owing === 0, `${owing} open bill(s)`);

  if (failed) throw new Error("a check failed — refusing to commit");
  if (COMMIT) { await c.query("commit"); console.log("\n✓ COMMITTED"); }
  else { await c.query("rollback"); console.log("\n✓ dry run only — rolled back, nothing written"); }
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("\n✗", e.message, "— rolled back");
  failed = true;
} finally {
  await c.end();
}
process.exit(failed ? 1 : 0);
