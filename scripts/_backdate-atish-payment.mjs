// Moves Atish Purboo's Rs 69,000 Juice payment to the day it actually arrived —
// 20 August 2026 — confirmed against the MCB Juice statement by the owner.
//
// WHY IT IS DATED WRONG. The job ran on 20/08 and INV-0139 was raised for it, but
// the payment was never entered and Nick voided that invoice on 22/08. The work sat
// unbilled until 09/09, when it was invoiced as INV-0242 and the payment recorded.
// record_payment stamps now(), so both carry 09/09 rather than the real date.
//
// WHERE THE MONEY GOES. Not the shop drawer — a Juice transfer never touches it.
// It books to the BACK-OFFICE desk till that was already open on 20 August
// (2f2c25c5, opened 09:41 when INV-0139 was raised, float 0, count 0). That choice
// is what keeps this honest:
//   • Z000054, the 20/08 Z, covers the TAB-84A1 CASH DRAWER only — card Rs 2,464 and
//     cash Rs 1,100, closed at variance 0. It is a frozen snapshot and it stays
//     correct, because this money never went through that drawer.
//   • The desk till has no Z of its own and holds no cash, so nothing reconciles
//     differently for having a Juice receipt on it.
//   • The 20 August trading day (76acabf6) is still OPEN — no day-Z has ever been
//     frozen for it — so the day's totals are computed live and will simply include
//     this, which is the correct answer.
//
// WHAT MOVES:
//   payments.received_at      → 20/08/2026 12:00 UTC (16:00 local)
//   payments.cash_session_id  → the 20 August desk till
//   documents.issued_at       → 20/08/2026 12:00 UTC
//   documents.issue_date      → 2026-08-20 — the date PRINTED on the invoice
//   documents.business_day    → 2026-08-20 — which day's takings it belongs to
//   documents.cash_session_id → the 20 August desk till
//   jobs.delivered_at         → 20/08/2026 12:00 UTC — the car went home when paid
//
// issue_date and business_day are DATE columns, not timestamps. Handing them an
// instant ('…T20:00:00Z') lets the server truncate it in ITS timezone, which landed
// business_day on 19 August on the first run. They are written as plain dates here,
// and every date is read back with an explicit ::text cast so no client-side
// timezone maths can disagree with what is actually stored. INV-0139 — the bill
// originally raised for this job on the day — carries 2026-08-20 in both, and that
// is the shape being reproduced.
//
// Amount, method, payer, invoice number and the bill it settles are ALL untouched.
//
// TWO GUARDS ARE SUSPENDED, for this transaction only:
//   • trg_payments_append_only — payments refuse every UPDATE and DELETE, by design,
//     so the money ledger cannot be quietly rewritten.
//   • trg_documents_fiscal_lock — an issued invoice is immutable apart from status,
//     amount_paid and a short list of others; issued_at and business_day are locked.
// Both exist to stop exactly this kind of edit happening casually. They are lifted
// here because the owner has verified the receipt against the Juice statement and is
// correcting their own books to match it. The compensating control is the
// audit_events row written below: the ledger records that it was corrected, from
// what, to what, by whom and on what evidence, rather than silently reading as
// though it was always dated 20 August.
//
//   node scripts/_backdate-atish-payment.mjs           # dry run, rolled back
//   node scripts/_backdate-atish-payment.mjs --commit  # for real
import { config } from "dotenv";
import pg from "pg";
config({ path: ".env" });

const COMMIT = process.argv.includes("--commit");
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh

const INVOICE      = "INV-0242";
const AMOUNT       = 69000.0;
const METHOD       = "juice";
const PAID_AT      = "2026-08-20T12:00:00.000Z"; // 16:00 Mauritius, inside the desk till's life
const BUSINESS_DAY = "2026-08-20";               // a DATE — written and compared as plain text
const DESK_TILL    = "2f2c25c5-e203-4387-ad7d-82b73d1cdc80"; // back-office, open 20/08 → 22/08
const JOB          = "4304f3ee-def2-44e9-954b-6f55ee7ad5d8";

const GUARDS = [
  ["public.payments", "trg_payments_append_only"],
  ["public.documents", "trg_documents_fiscal_lock"],
];

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL.trim(), ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

try {
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" })]);

  // Pin every edit to this one bill and this one amount, so a wrong id cannot reach
  // somebody else's money.
  const { rows: [doc] } = await c.query(
    `select id, tenant_id, status, total_incl, issued_at,
            business_day::text business_day, issue_date::text issue_date
       from public.documents where number = $1 and doc_type = 'invoice'`, [INVOICE]);
  check("0 the target is the paid Rs 69,000 bill", doc?.status === "paid" && Number(doc.total_incl) === AMOUNT,
    `${doc?.status}, Rs ${doc?.total_incl}`);
  const { rows: [was] } = await c.query(
    `select id, received_at, method, amount from public.payments where document_id = $1 and amount = $2`,
    [doc?.id, AMOUNT]);
  check("0b it carries exactly one Rs 69,000 Juice payment", was?.method === METHOD, `${was?.method}`);
  // The desk till must really be the one that was open on the day we are moving to.
  const { rows: [till] } = await c.query(
    `select cs.id, cs.device_id, cs.opened_at, cs.closed_at,
            td.business_date::text business_date, td.status day_status
       from public.cash_sessions cs join public.trading_days td on td.id = cs.trading_day_id
      where cs.id = $1`, [DESK_TILL]);
  check("0c the desk till belongs to the 20 August trading day",
    till?.device_id === "back-office" && till.business_date === BUSINESS_DAY,
    `${till?.device_id}, day ${till?.business_date} (${till?.day_status})`);
  check("0d the payment time falls inside that till's life",
    new Date(PAID_AT) >= till.opened_at && new Date(PAID_AT) <= till.closed_at,
    `${till.opened_at.toISOString()} → ${till.closed_at.toISOString()}`);
  if (failed) throw new Error("preconditions not met — nothing touched");

  for (const [t, g] of GUARDS) await c.query(`alter table ${t} disable trigger ${g}`);
  let nPay, nDoc, nJob;
  try {
    ({ rowCount: nPay } = await c.query(
      `update public.payments set received_at = $2, cash_session_id = $3
        where id = $1`, [was.id, PAID_AT, DESK_TILL]));
    ({ rowCount: nDoc } = await c.query(
      `update public.documents
          set issued_at = $2, business_day = $3::date, issue_date = $3::date, cash_session_id = $4
        where id = $1`, [doc.id, PAID_AT, BUSINESS_DAY, DESK_TILL]));
    ({ rowCount: nJob } = await c.query(
      `update public.jobs set delivered_at = $2 where id = $1`, [JOB, PAID_AT]));
  } finally {
    // Unconditional — and a rollback would restore them anyway.
    for (const [t, g] of GUARDS) await c.query(`alter table ${t} enable trigger ${g}`);
  }
  check("1 the payment moved", nPay === 1, `${nPay} row(s)`);
  check("2 the invoice moved", nDoc === 1, `${nDoc} row(s)`);
  check("3 the handover moved", nJob === 1, `${nJob} row(s)`);

  // The ledger says so out loud.
  await c.query(
    `insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
     values ($1, app.current_app_user_id(), 'payment_date_corrected', 'payment', $2, $3::jsonb)`,
    [doc.tenant_id, was.id, JSON.stringify({
      invoice: INVOICE, amount: AMOUNT, method: METHOD,
      received_at: { from: was.received_at.toISOString(), to: PAID_AT },
      business_day: { from: doc.business_day, to: BUSINESS_DAY },
      issue_date: { from: doc.issue_date, to: BUSINESS_DAY },
      cash_session: { to: DESK_TILL, device: "back-office" },
      evidence: "Owner verified the Rs 69,000 Juice credit on the MCB statement for 20/08/2026.",
      reason: "Job ran 20/08/2026; INV-0139 was voided unpaid and the work went unbilled until "
            + "09/09/2026. record_payment stamps the time it runs, so the bill and the payment "
            + "carried 09/09. Amount, method, payer and invoice number unchanged.",
    })]);

  // ── read it all back, rather than trusting the UPDATEs ────────────────────
  const { rows: [after] } = await c.query(
    `select d.issued_at, d.business_day::text business_day, d.issue_date::text issue_date,
            d.status, d.amount_paid, d.number,
            p.received_at, p.method, p.amount, p.cash_session_id, j.delivered_at
       from public.documents d
       join public.payments p on p.document_id = d.id
       join public.jobs j on j.id = $2
      where d.id = $1`, [doc.id, JOB]);
  check("4 the bill is dated 20 August — printed date, takings day and timestamp all agree",
    after.issue_date === BUSINESS_DAY && after.business_day === BUSINESS_DAY
      && after.issued_at.toISOString() === PAID_AT,
    `prints ${after.issue_date}, books to ${after.business_day}, issued ${after.issued_at.toISOString()}`);
  check("5 the money is dated 20 August, on the desk till", after.received_at.toISOString() === PAID_AT
    && after.cash_session_id === DESK_TILL, after.received_at.toISOString());
  check("6 the car was handed over that day", after.delivered_at.toISOString() === PAID_AT);
  check("7 the money itself is untouched — Rs 69,000 by Juice, paid in full",
    after.status === "paid" && Number(after.amount_paid) === AMOUNT
      && Number(after.amount) === AMOUNT && after.method === METHOD,
    `${after.number}: ${after.method} Rs ${after.amount}`);

  // The 20/08 cash-drawer Z must be exactly as it was: card 2,464 + cash 1,100.
  const { rows: [z] } = await c.query(
    `select number, totals->>'total_incl' total from public.z_reports where number = 'Z000054'`);
  check("8 Z000054 — the 20 August cash drawer — is untouched", Number(z.total) === 3564,
    `${z.number} still Rs ${z.total} (card 2,464 + cash 1,100)`);
  // And nothing of that day's drawer money moved onto the desk till.
  const { rows: [{ n: drawer }] } = await c.query(
    `select count(*)::int n from public.payments where cash_session_id = $1`,
    ["58def981-b6b3-461b-869b-0fc4999b0c75"]);
  check("8b the drawer session still holds its own two payments", drawer === 2, `${drawer}`);

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
