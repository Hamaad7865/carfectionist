// Finishes dating etienne gerare's Rs 1,650 card payment to 2 September 2026 — the
// day the customer actually paid, confirmed by the owner on CCTV.
//
// WHAT IS ALREADY RIGHT. issue_date (the date printed on the invoice), issued_at and
// the payment's received_at were corrected by hand and read 02/09. This finishes the
// job; it does not redo it.
//
// WHAT IS STILL WRONG. Three things kept today's date, and one of them is impossible
// on its face:
//   • documents.business_day = 09/09 — so the takings book to today, a week after the
//     invoice the customer holds says the sale happened.
//   • The payment sits on cash session 1b00b18a, the desk till that only OPENED on
//     09/09 06:16 — a payment stamped 02/09 hanging off a till that did not yet
//     exist. Nothing else in the ledger is shaped like that.
//   • jobs.delivered_at = 09/09, though the car went home the day it was paid for.
//
// WHERE THE MONEY GOES. The back-office desk till that was open on 2 September
// (d8935008, 02/09 14:54 → 05/09), not the shop drawer. That choice is what keeps
// this honest:
//   • Z000067, the 02/09 Z for the TAB-84A1 drawer, is a frozen snapshot: card
//     62,168.40 + cash 4,950.01 + juice 5,574 across 8 payments. This Rs 1,650 was
//     never in that session when it closed, so writing it in now would make the Z
//     contradict the ledger it is supposed to summarise. It stays untouched, and the
//     script asserts as much.
//   • The 2 September trading day (67d9f5cd) is still OPEN — no day-Z has ever been
//     frozen for it — so the day's totals compute live and simply pick this up.
//
// WHAT MOVES:
//   payments.cash_session_id  → the 2 September desk till
//   documents.business_day    → 2026-09-02 — which day's takings it belongs to
//   documents.cash_session_id → the 2 September desk till
//   jobs.delivered_at         → 02/09/2026 12:00 UTC
//   documents.issue_date      → rewritten to 2026-09-02; already correct, kept for
//                               symmetry with the Atish script so both read alike
//
// business_day and issue_date are DATE columns, not timestamps. Handing them an
// instant lets the server truncate it in ITS timezone — that is what put Atish's
// business_day on 19 August instead of the 20th on the first run. Written as plain
// dates, and read back with ::text so no client-side timezone maths can disagree
// with what is stored.
//
// TWO GUARDS ARE SUSPENDED, for this transaction only — trg_payments_append_only
// (payments refuse every UPDATE and DELETE) and trg_documents_fiscal_lock (an issued
// invoice is immutable apart from status, amount_paid and a short list of others).
// They exist to stop exactly this edit happening casually. The compensating control
// is the audit_events row written below.
//
// Amount, method, payer, invoice number and the bill it settles are ALL untouched.
//
//   node scripts/_backdate-etienne-payment.mjs           # dry run, rolled back
//   node scripts/_backdate-etienne-payment.mjs --commit  # for real
import { config } from "dotenv";
import pg from "pg";
config({ path: ".env" });

const COMMIT = process.argv.includes("--commit");
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh

const INVOICE      = "INV-0238";
const AMOUNT       = 1650.0;
const METHOD       = "card";
const PAID_AT      = "2026-09-02T12:00:00.000Z"; // already on the payment; asserted, not changed
const BUSINESS_DAY = "2026-09-02";               // a DATE — written and compared as plain text
const DESK_TILL    = "d8935008-2b7e-43ce-be64-498f403be96a"; // back-office, open 02/09 → 05/09
const JOB          = "7e86502e-49fc-4680-a554-61cfb2f4d133"; // e1052 mercedes 204
const DRAWER       = "ffb2ed17-8fd6-4358-83c5-287fc19f1514"; // TAB-84A1 on 02/09 — must not move

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

  const { rows: [doc] } = await c.query(
    `select id, tenant_id, status, total_incl, issued_at,
            business_day::text business_day, issue_date::text issue_date
       from public.documents where number = $1 and doc_type = 'invoice'`, [INVOICE]);
  check("0 the target is the paid Rs 1,650 bill", doc?.status === "paid" && Number(doc.total_incl) === AMOUNT,
    `${doc?.status}, Rs ${doc?.total_incl}`);
  const { rows: [was] } = await c.query(
    `select id, received_at, method, amount, cash_session_id from public.payments
      where document_id = $1 and amount = $2`, [doc?.id, AMOUNT]);
  check("0b it carries exactly one Rs 1,650 card payment", was?.method === METHOD, `${was?.method}`);
  // The hand-made half must already be in place — this script finishes, never redoes.
  check("0c the dates already corrected by hand are intact",
    doc.issue_date === BUSINESS_DAY && doc.issued_at.toISOString() === PAID_AT
      && was.received_at.toISOString() === PAID_AT,
    `prints ${doc.issue_date}, paid ${was.received_at.toISOString()}`);
  const { rows: [till] } = await c.query(
    `select cs.id, cs.device_id, cs.opened_at, cs.closed_at,
            td.business_date::text business_date, td.status day_status
       from public.cash_sessions cs join public.trading_days td on td.id = cs.trading_day_id
      where cs.id = $1`, [DESK_TILL]);
  check("0d the desk till belongs to the 2 September trading day",
    till?.device_id === "back-office" && till.business_date === BUSINESS_DAY,
    `${till?.device_id}, day ${till?.business_date} (${till?.day_status})`);
  check("0e the payment time falls inside that till's life — unlike the one it is on now",
    new Date(PAID_AT) >= till.opened_at && new Date(PAID_AT) <= till.closed_at,
    `${till.opened_at.toISOString()} → ${till.closed_at.toISOString()}`);
  if (failed) throw new Error("preconditions not met — nothing touched");

  const drawerBefore = await c.query(
    `select count(*)::int n, coalesce(sum(amount),0)::text total from public.payments where cash_session_id = $1`,
    [DRAWER]);

  for (const [t, g] of GUARDS) await c.query(`alter table ${t} disable trigger ${g}`);
  let nPay, nDoc, nJob;
  try {
    ({ rowCount: nPay } = await c.query(
      `update public.payments set cash_session_id = $2 where id = $1`, [was.id, DESK_TILL]));
    ({ rowCount: nDoc } = await c.query(
      `update public.documents
          set business_day = $2::date, issue_date = $2::date, cash_session_id = $3
        where id = $1`, [doc.id, BUSINESS_DAY, DESK_TILL]));
    ({ rowCount: nJob } = await c.query(
      `update public.jobs set delivered_at = $2 where id = $1`, [JOB, PAID_AT]));
  } finally {
    for (const [t, g] of GUARDS) await c.query(`alter table ${t} enable trigger ${g}`);
  }
  check("1 the payment moved to the 2 Sept till", nPay === 1, `${nPay} row(s)`);
  check("2 the invoice moved", nDoc === 1, `${nDoc} row(s)`);
  check("3 the handover moved", nJob === 1, `${nJob} row(s)`);

  await c.query(
    `insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
     values ($1, app.current_app_user_id(), 'payment_date_corrected', 'payment', $2, $3::jsonb)`,
    [doc.tenant_id, was.id, JSON.stringify({
      invoice: INVOICE, amount: AMOUNT, method: METHOD,
      business_day: { from: doc.business_day, to: BUSINESS_DAY },
      cash_session: { from: was.cash_session_id, to: DESK_TILL, device: "back-office" },
      delivered_at: { to: PAID_AT },
      evidence: "Owner confirmed on CCTV that the customer paid Rs 1,650 by card at the counter on 02/09/2026.",
      reason: "Quote A00180 revised the already-invoiced A00179; INV-0204 was left issued and unpaid and "
            + "the Rs 1,650 bill was never issued until 09/09/2026. record_payment stamps the time it runs. "
            + "issue_date, issued_at and received_at were corrected by hand; this completes the takings day, "
            + "the till and the handover. Amount, method, payer and invoice number unchanged.",
    })]);

  // ── read it all back ──────────────────────────────────────────────────────
  const { rows: [after] } = await c.query(
    `select d.issued_at, d.business_day::text business_day, d.issue_date::text issue_date,
            d.status, d.amount_paid, d.number,
            p.received_at, p.method, p.amount, p.cash_session_id, j.delivered_at
       from public.documents d
       join public.payments p on p.document_id = d.id
       join public.jobs j on j.id = $2
      where d.id = $1`, [doc.id, JOB]);
  check("4 the bill is dated 2 September — printed date, takings day and timestamp all agree",
    after.issue_date === BUSINESS_DAY && after.business_day === BUSINESS_DAY
      && after.issued_at.toISOString() === PAID_AT,
    `prints ${after.issue_date}, books to ${after.business_day}, issued ${after.issued_at.toISOString()}`);
  check("5 the money is dated 2 September, on a till that was open that day",
    after.received_at.toISOString() === PAID_AT && after.cash_session_id === DESK_TILL,
    after.received_at.toISOString());
  check("6 the car was handed over that day", after.delivered_at.toISOString() === PAID_AT);
  check("7 the money itself is untouched — Rs 1,650 by card, paid in full",
    after.status === "paid" && Number(after.amount_paid) === AMOUNT
      && Number(after.amount) === AMOUNT && after.method === METHOD,
    `${after.number}: ${after.method} Rs ${after.amount}`);

  // The 02/09 drawer and its frozen Z must be exactly as they were.
  const drawerAfter = await c.query(
    `select count(*)::int n, coalesce(sum(amount),0)::text total from public.payments where cash_session_id = $1`,
    [DRAWER]);
  check("8 the 2 Sept drawer session is untouched",
    drawerAfter.rows[0].n === drawerBefore.rows[0].n && drawerAfter.rows[0].total === drawerBefore.rows[0].total,
    `${drawerAfter.rows[0].n} payments, Rs ${drawerAfter.rows[0].total}`);
  const { rows: [z] } = await c.query(
    `select number, totals->>'total_incl' total from public.z_reports where number = 'Z000067'`);
  check("8b Z000067 — the 2 September drawer Z — is untouched", Number(z.total) === 7884.01,
    `${z.number} still Rs ${z.total}`);

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
