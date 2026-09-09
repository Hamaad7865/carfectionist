// INV-0238 — etienne gerard's Rs 1,650 bill — now reads as the day the work and
// the money actually happened: 02/09/2026.
//
// WHAT WENT WRONG. The bill was drafted at job-ready on 02/09 but only ISSUED on
// 09/09 by _fix-etienne-payment.mjs (the counter had left the visit half-billed),
// so issue_date/issued_at stamp 09/09 while the quote, the job, the car handover
// and — since _fix-etienne-gerard.mjs — the payment all read 02/09. The client's
// history read like two visits.
//
// WHAT THIS DOES — one row, two columns, run as the owner so the audit actor is real:
//   issue_date → 2026-09-02 00:00 Mauritius (the trading day, encoded like every
//                                 other row — issue_date is a midnight+04 stamp)
//   issued_at  → 2026-09-02 16:00 Mauritius (the counter moment, same instant the
//                                 payment's received_at already carries)
//
// THE ONE DELIBERATE GUARD BYPASS. enforce_document_lock freezes issued fiscal
// documents to a mutable whitelist that does not include either date. The owner
// has directed the correction, so this disables trg_documents_fiscal_lock,
// updates exactly one guarded row, and re-enables the trigger BEFORE the commit
// check — verified in check 5. The other document triggers are transition-fired
// and provably idle here: refuse_double_bill runs only on draft→issued,
// stamp_issued_by only when issued_at goes null→non-null.
//
// WHAT DOES NOT MOVE. The fiscal number INV-0238 (immutable, and honestly minted
// 09/09 — its place in the sequence is a fact), the payment row (already 02/09
// 16:00 since _fix-etienne-gerard.mjs), stock, sessions, amounts. Void INV-0204
// and superseded A00179 stay in the archive where the working lists already hide
// them; the contact history panels now hide them too (web + Android).
//
//   node scripts/_fix-etienne-1650-on-2sept.mjs           # dry run, rolled back
//   node scripts/_fix-etienne-1650-on-2sept.mjs --commit  # for real
import { config } from "dotenv";
import pg from "pg";
config({ path: ".env" });

const COMMIT = process.argv.includes("--commit");
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh — the actor on the row
const INVOICE   = "9290f7ee-d105-4e3e-a83d-a8dfca0345b0";  // INV-0238, Rs 1,650, paid
const ISSUE_DAY = "2026-09-02";                  // the trading day the work belongs to (date column)
const ISSUE_AT  = "2026-09-02T16:00:00+04:00"; // 16:00 Mauritius — when the money moved

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

  // Guard: still the bill this script was written against.
  const { rows: [before] } = await c.query(
    `select number, status, total_incl, amount_paid, issue_date, issued_at, issued_by
       from public.documents where id = $1`, [INVOICE]);
  check("0 INV-0238 is still the paid Rs 1,650 bill stamped 09/09",
    before?.number === "INV-0238" && before?.status === "paid"
      && Number(before.total_incl) === 1650
      && before.issue_date.toISOString().startsWith("2026-09-08T20:00")   // 09/09 midnight+04
      && before.issued_at.toISOString().startsWith("2026-09-09"),
    `${before?.number} ${before?.status} issue_date=${before?.issue_date?.toISOString()} issued_at=${before?.issued_at?.toISOString()}`);

  // ── the correction ────────────────────────────────────────────────────────
  await c.query(`alter table public.documents disable trigger trg_documents_fiscal_lock`);
  const { rowCount: moved } = await c.query(
    `update public.documents set issue_date = $2::date, issued_at = $3
      where id = $1 and number = 'INV-0238' and status = 'paid'
        and issue_date = date '2026-09-09'`,
    [INVOICE, ISSUE_DAY, ISSUE_AT]);
  await c.query(`alter table public.documents enable trigger trg_documents_fiscal_lock`);
  check("1 exactly one row moved", moved === 1, `${moved} row(s)`);

  // ── verify the row now reads as one visit ─────────────────────────────────
  const { rows: [after] } = await c.query(
    `select number, status, total_incl, amount_paid, issue_date, issued_at, issued_by
       from public.documents where id = $1`, [INVOICE]);
  check("2 the bill is dated 02/09/2026",
    after.issue_date.toISOString() === "2026-09-01T20:00:00.000Z"
      && after.issued_at.toISOString() === "2026-09-02T12:00:00.000Z",
    `issue_date=${after.issue_date.toISOString()} issued_at=${after.issued_at.toISOString()}`);
  check("3 nothing else about the bill changed",
    after.number === before.number && after.status === before.status
      && after.total_incl === before.total_incl && after.amount_paid === before.amount_paid
      && after.issued_by === before.issued_by);
  const { rows: [pay] } = await c.query(
    `select to_char(received_at, 'YYYY-MM-DD') d, amount, method from public.payments where document_id = $1`, [INVOICE]);
  check("4 the payment still reads 02/09 — bill and money tell one story",
    pay.d === "2026-09-02" && Number(pay.amount) === 1650,
    `${pay.method} Rs ${pay.amount} on ${pay.d}`);

  const { rows: [{ enabled }] } = await c.query(
    `select tgenabled = 'O' enabled from pg_trigger where tgname = 'trg_documents_fiscal_lock'`);
  check("5 the fiscal lock is re-enabled", enabled === true);

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
