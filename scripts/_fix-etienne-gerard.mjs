// Corrects etienne gerare's record after the 09/09 fix: the client's name is
// "etienne gerard" (the counter dropped the d), and the Rs 1,650 card payment
// on INV-0238 should read as the day the money actually moved — 02/09/2026,
// confirmed on CCTV — not the day the fix script booked it.
//
// WHAT THIS DOES, in order — run as the owner so RLS and the audit actor are real:
//   1. rename the customer "etienne gerare" → "etienne gerard". Every screen
//      (web sales/history, Android till) reads the live customers.name join
//      first, so this alone fixes what everyone sees;
//   2. correct the bill_to_name snapshot on his two QUOTES (A00179, A00180) —
//      quotes are not fiscally locked;
//   3. set the payment's received_at to 02/09/2026 16:00 Mauritius — 39 minutes
//      after his intake record was created, "paid at the counter" per the CCTV
//      note. created_at stays 09/09: that is when the row really was written.
//
// THE ONE DELIBERATE GUARD BYPASS. payments is append-only (trg_payments_
// append_only raises on any UPDATE) — that is why the earlier fix scripts
// could not backdate and left the true date in a note. Here the owner has
// explicitly directed the payment to read 02/09, so this script disables that
// one trigger, updates exactly one guarded row (id + document + method +
// amount + booked-today), and re-enables the trigger BEFORE the final commit
// check — verified in check 7. Nothing else about the payment moves: amount,
// method, till session, received_by all stay as booked.
//
// WHAT DOES NOT MOVE. The two issued invoices (INV-0204 void, INV-0238 paid)
// keep their bill_to_name snapshot: enforce_document_lock freezes issued
// fiscal documents, and their paper is what it is — screens show the live
// customer name anyway. The payment stays booked to the 09/09 back-office
// till session: the 02/09 Z is frozen, and today's session tally still
// carries the Rs 1,650, same policy as _fix-etienne-payment.mjs. INV-0238's
// fiscal number and issue date stay 09/09 — their place in the sequence is
// a fact.
//
//   node scripts/_fix-etienne-gerard.mjs           # dry run, rolled back
//   node scripts/_fix-etienne-gerard.mjs --commit  # for real
import { config } from "dotenv";
import pg from "pg";
config({ path: ".env" });

const COMMIT = process.argv.includes("--commit");
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh — the actor on every row below
const CUSTOMER  = "7e9e735b-71c1-4695-951a-1d923a425249";  // "etienne gerare" → "etienne gerard"
const PAYMENT   = "70e4aea9-1032-4e5c-8548-d8aff750e96f";  // Rs 1,650 card on INV-0238
const INVOICE   = "9290f7ee-d105-4e3e-a83d-a8dfca0345b0";  // INV-0238
const RIGHT_NAME = "etienne gerard";
const WRONG_NAME = "etienne gerare";
const REAL_PAID_AT = "2026-09-02T16:00:00+04:00"; // 16:00 Mauritius, 02/09/2026

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

  // Guard: everything must still be as it was when this was written.
  const { rows: [pay0] } = await c.query(
    `select method, amount, received_at, cash_session_id, booked_session_id
       from public.payments where id = $1 and document_id = $2`, [PAYMENT, INVOICE]);
  check("0 the payment is still the Rs 1,650 card booked today",
    pay0?.method === "card" && Number(pay0.amount) === 1650
      && pay0.received_at.toISOString().slice(0, 10) === "2026-09-09",
    `${pay0?.method} Rs ${pay0?.amount} at ${pay0?.received_at?.toISOString()}`);

  // ── 1. the client's name ──────────────────────────────────────────────────
  const { rowCount: renamed } = await c.query(
    `update public.customers set name = $2, updated_at = now()
      where id = $1 and name = $3`, [CUSTOMER, RIGHT_NAME, WRONG_NAME]);
  check("1 the client reads etienne gerard", renamed === 1, `${renamed} row(s)`);

  // ── 2. the snapshots on his quotes (invoices are fiscally locked — see head) ──
  const { rowCount: quotes } = await c.query(
    `update public.documents set bill_to_name = $2
      where customer_id = $1 and doc_type = 'quote' and bill_to_name = $3`,
    [CUSTOMER, RIGHT_NAME, WRONG_NAME]);
  check("2 both quotes carry the corrected name", quotes === 2, `${quotes} quote(s)`);
  const { rows: [{ n: lockedOld }] } = await c.query(
    `select count(*)::int n from public.documents
      where customer_id = $1 and doc_type = 'invoice' and bill_to_name = $2`,
    [CUSTOMER, WRONG_NAME]);
  check("2b the two issued invoices keep their frozen snapshots (untouched)", lockedOld === 2,
    `${lockedOld} invoice(s)`);

  // ── 3. when the money moved ───────────────────────────────────────────────
  await c.query(`alter table public.payments disable trigger trg_payments_append_only`);
  const { rowCount: moved } = await c.query(
    `update public.payments set received_at = $2
      where id = $1 and document_id = $3 and method = 'card' and amount = 1650
        and received_at::date = '2026-09-09'`,
    [PAYMENT, REAL_PAID_AT, INVOICE]);
  await c.query(`alter table public.payments enable trigger trg_payments_append_only`);
  check("3 exactly one payment row moved", moved === 1, `${moved} row(s)`);
  const { rows: [pay1] } = await c.query(
    `select received_at, created_at, method, amount, cash_session_id, booked_session_id
       from public.payments where id = $1`, [PAYMENT]);
  check("3b the payment reads 02/09/2026",
    pay1.received_at.toISOString() === "2026-09-02T12:00:00.000Z",
    pay1.received_at.toISOString());
  check("3c nothing else about the row changed — amount, method, sessions as booked",
    pay1.method === pay0.method && Number(pay1.amount) === Number(pay0.amount)
      && pay1.booked_session_id === pay0.booked_session_id
      && pay1.cash_session_id === pay0.cash_session_id);
  check("3d the row's own creation stays honest — 09/09",
    pay1.created_at.toISOString().slice(0, 10) === "2026-09-09", pay1.created_at.toISOString());

  // ── what the apps will now show ───────────────────────────────────────────
  const { rows: [doc] } = await c.query(
    `select status, amount_paid, (select name from public.customers where id = d.customer_id) name
       from public.documents d where id = $1`, [INVOICE]);
  check("4 INV-0238 is still paid in full to etienne gerard",
    doc.status === "paid" && Number(doc.amount_paid) === 1650 && doc.name === RIGHT_NAME,
    `${doc.status}, ${doc.name}`);
  const { rows: [{ n: owing }] } = await c.query(
    `select count(*)::int n from public.documents
      where customer_id = $1 and doc_type = 'invoice' and status not in ('void','draft')
        and coalesce(amount_paid, 0) < total_incl`, [CUSTOMER]);
  check("5 nothing of his is still outstanding", owing === 0, `${owing} open bill(s)`);

  // The append-only guard must be back on its feet before we commit.
  const { rows: [{ enabled }] } = await c.query(
    `select tgenabled = 'O' enabled from pg_trigger where tgname = 'trg_payments_append_only'`);
  check("6 the append-only guard is re-enabled", enabled === true);

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
