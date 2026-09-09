// Bills and settles etienne gerare's visit of 2 Sept 2026 — the one the counter
// left half-finished when the quote was revised.
//
// WHAT WENT WRONG. A00179 (WIPER 24 ×2, Rs 1,320) was accepted, which auto-issued
// INV-0204 and took two wipers out of the Shop. Two minutes later the quote was
// revised to A00180 (Rs 1,650: the wipers plus two clips), signed, and turned into
// job e1052. At job-ready a SECOND invoice was drafted for Rs 1,650 and never
// issued. INV-0204 was never voided, so the shop carried a live Rs 1,320 bill for
// work that a Rs 1,650 bill also covers, and the wipers would have left stock twice.
//
// The owner confirms (CCTV) that the customer paid Rs 1,650 by CARD.
//
// WHAT THIS DOES, in order — each step through the RPC the app itself uses, run as
// the owner so RLS, require_role and the audit actor are all real:
//   1. void INV-0204 — puts the two wipers BACK on the Shop floor;
//   2. stamp the draft with an internal note saying when the money really arrived;
//   3. issue the Rs 1,650 draft — mints the fiscal number and takes those same two
//      wipers out again. Net stock effect across 1 and 3 is zero;
//   4. record Rs 1,650 by card against the back-office till.
//
// DATING. record_payment stamps now(); there is no backdating through it, and a
// direct write would bypass the till, the amount_paid rollup and the audit. So the
// bill and the payment land on TODAY's trading day and today's Z, and the real
// receipt date is recorded in the document's internal comment instead.
//
//   node scripts/_fix-etienne-payment.mjs           # dry run, rolled back
//   node scripts/_fix-etienne-payment.mjs --commit  # for real
import { config } from "dotenv";
import pg from "pg";
config({ path: ".env" });

const COMMIT = process.argv.includes("--commit");
const TENANT = "11111111-1111-4111-8111-000000000001";
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh — the actor on every audit row below

const STALE_INVOICE = "3188bcf3-5f6f-4c0e-9930-6dc22a333e7e"; // INV-0204, Rs 1,320, issued & unpaid
const DRAFT_INVOICE = "9290f7ee-d105-4e3e-a83d-a8dfca0345b0"; // the Rs 1,650 bill, never issued
const JOB           = "7e86502e-49fc-4680-a554-61cfb2f4d133"; // e1052, ready since 2 Sept
const WIPER         = "2f172d1b-d0ea-4a5a-a364-5e644dc7597c";
const SHOP          = "0a000000-0000-4000-8000-000000000002"; // where INV-0204's wipers left from
const AMOUNT        = 1650.0;
const METHOD        = "card";
// record_payment refuses a card payment with no external reference. "POS" is what
// the shop's own terminal writes — every card and Juice row in the live data reads
// that way — so this is the reference the till itself would have left on 2 Sept.
const EXTERNAL_REF  = "POS";
const NOTE = "Paid Rs 1,650 by card on 02/09/2026 at the counter (confirmed on CCTV). "
           + "Billed and recorded 09/09/2026 — INV-0204 was voided as superseded by revised quote A00180.";

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL.trim(), ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};
const shopQty = async () => {
  const { rows } = await c.query(
    `select coalesce(sum(qty), 0)::numeric q from public.stock_movements
      where tenant_id = $1 and product_id = $2 and location_id = $3`, [TENANT, WIPER, SHOP]);
  return Number(rows[0].q);
};

try {
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" })]);

  // The desk till every web-side payment books to. The gate rejects a null session
  // for ALL methods, card included, so this is not optional.
  const { rows: [till] } = await c.query(
    `select id from public.cash_sessions
      where tenant_id = $1 and device_id = 'back-office' and status = 'open'
      order by opened_at desc limit 1`, [TENANT]);
  if (!till) throw new Error("no open back-office till — run the back_office_till RPC first");
  console.log(`→ desk till ${till.id}\n`);

  const wipersBefore = await shopQty();

  // ── 1. the stale bill goes ────────────────────────────────────────────────
  const { rows: [voided] } = await c.query(
    `select status, void_reason from public.void_document($1, $2)`,
    [STALE_INVOICE, "Superseded by revised quote A00180 — rebilled at Rs 1,650"]);
  check("1 INV-0204 is void", voided.status === "void", voided.void_reason);
  check("1b the two wipers came back to the Shop", (await shopQty()) === wipersBefore + 2,
    `${wipersBefore} → ${await shopQty()}`);

  // ── 2. say when the money really arrived (internal note, never on the PDF) ──
  await c.query(`update public.documents set comment = $2 where id = $1 and status = 'draft'`, [DRAFT_INVOICE, NOTE]);

  // ── 3. issue the real bill ────────────────────────────────────────────────
  const { rows: [inv] } = await c.query(
    `select id, number, status, total_incl from public.issue_document($1, $2, $3, $4)`,
    [DRAFT_INVOICE, SHOP, "fix-etienne-20260909:issue", till.id]);
  check("3 the Rs 1,650 bill is issued and numbered", inv.status === "issued" && !!inv.number,
    `${inv.number} — Rs ${inv.total_incl}`);
  check("3b it is the amount the owner confirmed", Number(inv.total_incl) === AMOUNT, `Rs ${inv.total_incl}`);
  check("3c stock is back where it started — the wipers left ONCE, not twice",
    (await shopQty()) === wipersBefore, `${wipersBefore} → ${await shopQty()}`);

  // ── 4. the money ──────────────────────────────────────────────────────────
  await c.query(
    `select public.record_payment($1, $2::payment_method, $3, null, $4, $5, null, $6)`,
    [inv.id, METHOD, AMOUNT, EXTERNAL_REF, till.id, "fix-etienne-20260909:collect"]);

  // ── verify the rollup actually moved, rather than trusting the call ────────
  const { rows: [after] } = await c.query(
    `select status, amount_paid, total_incl from public.documents where id = $1`, [inv.id]);
  check("4 the bill reads as paid in full", after.status === "paid" && Number(after.amount_paid) === AMOUNT,
    `${after.status}, Rs ${after.amount_paid} of ${after.total_incl}`);
  const { rows: [pay] } = await c.query(
    `select p.method, p.amount, p.cash_session_id, u.display_name taker
       from public.payments p left join public.app_users u on u.id = p.received_by
      where p.document_id = $1`, [inv.id]);
  check("4b one card payment, booked to the desk till",
    pay?.method === METHOD && Number(pay.amount) === AMOUNT && pay.cash_session_id === till.id,
    `${pay?.method} Rs ${pay?.amount} by ${pay?.taker}`);
  const { rows: [job] } = await c.query(`select status, delivered_at from public.jobs where id = $1`, [JOB]);
  check("4c the car is marked handed over", job.status === "delivered" && !!job.delivered_at, job.status);

  // Nothing of etienne's is left owing anywhere.
  const { rows: [{ n: owing }] } = await c.query(
    `select count(*)::int n from public.documents
      where customer_id = (select customer_id from public.documents where id = $1)
        and doc_type = 'invoice' and status not in ('void','draft')
        and coalesce(amount_paid, 0) < total_incl`, [inv.id]);
  check("5 nothing of his is still outstanding", owing === 0, `${owing} open bill(s)`);

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
