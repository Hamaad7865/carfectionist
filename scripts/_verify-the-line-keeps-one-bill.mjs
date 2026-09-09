// Verifies 20260910000010_the_line_keeps_one_bill.sql against the LIVE DB, all
// of it inside ONE BEGIN/ROLLBACK — the migration is loaded inside the txn, so
// not a single probe row or function change survives. The live TESTQ-00048..51
// rows are only READ (the standing-draft notice), never touched.
//
//   A. THE INCIDENT, REPLAYED — quote billed at the counter, revised three deep,
//      the last accepted with a technician: the root's draft leaves the till at
//      the ACCEPT (TESTQ-00048's shape: job-less line, no re-price branch).
//   B. THE BILL DOOR — same shape accepted at the counter: the root's draft
//      leaves when the revision is billed.
//   C. NO RIVAL MINT — billing the superseded parent returns the line's standing
//      bill instead of minting a second draft at the rejected price.
//   D. STILL DOWNSTREAM AFTER IT'S LIVE — the standing bill handed back is the
//      same row once issued; no second number appears.
//   E. THE GUARD SURVIVES — billing a revision over a LIVE ancestor bill still
//      refuses (the owner's void-or-credit call, 20260909000010 intact).
//   F. THE QUOTE'S OWN BILL IS NOT COLLATERAL — a draft raised by "Bill now"
//      before the accept survives it and is claimed by the job.
//   G. A COPY SUPERSEDES NOTHING — billing a copy leaves the original's draft
//      standing (revision_of, not source_document_id).
//   H. THE MIDDLE OF THE LINE — billing a mid-chain quote mints nothing when a
//      descendant already carries the line's bill.
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import pg from "pg";
config({ path: ".env" });

const TENANT = "11111111-1111-4111-8111-000000000001";
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh's AUTH uid — goes in JWT claims
const MIGRATION = "supabase/migrations/20260910000010_the_line_keeps_one_bill.sql";

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL.trim(), ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

// A raise poisons the whole txn, so every expected failure runs under its own savepoint.
const refuses = async (sql, args) => {
  await c.query("savepoint probe");
  try {
    await c.query(sql, args);
    await c.query("release savepoint probe");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint probe");
    return e.message;
  }
};

try {
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" })]);
  await c.query(readFileSync(MIGRATION, "utf8"));
  console.log("→ migration loaded inside the txn\n");

  const { rows: [cust] } = await c.query(
    `insert into public.customers (tenant_id, name, phone) values ($1, 'ZZ Probe One Bill', '5000 0002') returning id`, [TENANT]);
  const { rows: [{ id: car }] } = await c.query(
    `insert into public.vehicles (tenant_id, customer_id, plate) values ($1, $2, 'ZZ ONE 1') returning id`, [TENANT, cust.id]);

  const newQuote = async (title, price) => {
    const { rows: [q] } = await c.query(
      `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
      [JSON.stringify({ doc_type: "quote", customer_id: cust.id, vehicle_id: car }),
       JSON.stringify([{ title, qty: 1, unit_price: price, vat_rate: 15, sort_order: 0, line_kind: "service", vehicle_id: car }])]);
    await c.query(`select * from public.issue_document($1, null, null, null)`, [q.id]);
    return q.id;
  };
  const bill = async (quoteId) => (await c.query(`select * from public.convert_quote_to_invoice($1)`, [quoteId])).rows[0];
  const lineInvoiceCount = async (ids) => (await c.query(
    `select count(*)::int n from public.documents
      where doc_type = 'invoice' and status <> 'void' and source_document_id = any($1)`, [ids])).rows[0].n;

  // ── A. the incident, replayed ──────────────────────────────────────────────
  const q1 = await newQuote("Polish — the incident", 18150.01);
  const d1 = await bill(q1);
  check("A1 the counter sale mints a job-less draft", d1.status === "draft" && d1.job_id === null, d1.status);

  const q2 = (await c.query(`select * from public.revise_quote($1)`, [q1])).rows[0].id;
  await c.query(`select * from public.issue_document($1, null, null, null)`, [q2]);
  const q3 = (await c.query(`select * from public.revise_quote($1)`, [q2])).rows[0].id;
  await c.query(`select * from public.issue_document($1, null, null, null)`, [q3]);
  const revision = (await c.query(`select revision_of from public.documents where id = $1`, [q3])).rows[0];
  check("A2 the chain is three deep", revision.revision_of === q2, String(revision.revision_of));

  const job = (await c.query(`select * from public.convert_quote_to_job($1, null, null, null)`, [q3])).rows[0];
  check("A3 the revision is accepted onto a job", job?.source_quote_id === q3, job?.source_quote_id);
  const d1Gone = (await c.query(`select count(*)::int n from public.documents where id = $1`, [d1.id])).rows[0].n === 0;
  check("A4 the superseded root's draft left the till AT THE ACCEPT", d1Gone);
  const lineLeft = await lineInvoiceCount([q1, q2, q3]);
  check("A5 no bill from the superseded quotes remains", lineLeft === 0, `${lineLeft} left`);
  const audit = (await c.query(
    `select payload->>'replaced_by_quote' as by from public.audit_events
      where event_type = 'draft_discarded' and ref_id = $1`, [d1.id])).rows[0];
  check("A6 the discard is on the audit trail, naming the new price", audit?.by === q3, String(audit?.by));

  // ── B. the bill door ──────────────────────────────────────────────────────
  const q4 = await newQuote("Polish — the counter door", 18150.01);
  const d4 = await bill(q4);
  const q5 = (await c.query(`select * from public.revise_quote($1)`, [q4])).rows[0].id;
  await c.query(`select * from public.issue_document($1, null, null, null)`, [q5]);
  const d5 = await bill(q5);
  check("B1 the revision is billed on its own draft", d5.status === "draft" && d5.source_document_id === q5, d5.source_document_id);
  const d4Gone = (await c.query(`select count(*)::int n from public.documents where id = $1`, [d4.id])).rows[0].n === 0;
  check("B2 the root's draft left when the revision was BILLED", d4Gone);

  // ── C. no rival mint ──────────────────────────────────────────────────────
  const again = await bill(q4);
  check("C1 billing the superseded parent returns the line's standing bill", again.id === d5.id, `${again.id} vs ${d5.id}`);
  check("C2 the line still holds exactly one bill", (await lineInvoiceCount([q4, q5])) === 1);

  // ── D. still downstream once live ─────────────────────────────────────────
  await c.query(`select * from public.issue_document($1, null, null, null)`, [d5.id]);
  const liveBack = await bill(q4);
  check("D1 a live standing bill is handed back, not doubled", liveBack.id === d5.id && liveBack.status === 'issued', liveBack.status);
  check("D2 no second number was minted", (await lineInvoiceCount([q4, q5])) === 1);

  // ── E. the guard survives — LIVE ancestor bills stay the owner's call ─────
  const q8 = await newQuote("Polish — the guard", 1500);
  const d8 = await bill(q8);
  await c.query(`select * from public.issue_document($1, null, null, null)`, [d8.id]);
  // revise_quote refuses a billed quote outright, so the legacy shape is written the
  // way 20260909000010's data actually looks: the revision predates the guard.
  const { rows: [q9] } = await c.query(
    `insert into public.documents (tenant_id, doc_type, status, customer_id, vehicle_id, source_document_id, revision_of, created_by)
     values ($1, 'quote', 'draft', $2, $3, $4, $4, null) returning id`, [TENANT, cust.id, car, q8]);
  await c.query(
    `insert into public.document_lines (tenant_id, document_id, title, qty, unit_price, vat_rate, sort_order, line_kind)
     select tenant_id, $2, title, qty, unit_price, vat_rate, sort_order, line_kind
       from public.document_lines where document_id = $1`, [q8, q9.id]);
  await c.query(`select * from public.issue_document($1, null, null, null)`, [q9.id]);
  const refusal = await refuses(`select * from public.convert_quote_to_invoice($1)`, [q9.id]);
  check("E1 billing over a LIVE ancestor bill still refuses", refusal !== null && /already been billed/.test(refusal), refusal ?? "no refusal");
  const d8Alive = (await c.query(`select status from public.documents where id = $1`, [d8.id])).rows[0];
  check("E2 the live bill was not touched by the refusal", d8Alive?.status === "issued", d8Alive?.status);

  // ── F. the quote's own bill is not collateral ─────────────────────────────
  const q6 = await newQuote("Polish — own bill", 2000);
  const d6 = await bill(q6);
  const job6 = (await c.query(`select * from public.convert_quote_to_job($1, null, null, null)`, [q6])).rows[0];
  const d6Row = (await c.query(`select job_id from public.documents where id = $1`, [d6.id])).rows[0];
  check("F1 the quote's OWN draft survived its accept", d6Row != null);
  check("F2 and was claimed by the job", d6Row?.job_id === job6.id, String(d6Row?.job_id));

  // ── G. a copy supersedes nothing ──────────────────────────────────────────
  const q7 = await newQuote("Polish — the copy", 2500);
  const d7 = await bill(q7);
  const copy = (await c.query(`select * from public.duplicate_document($1)`, [q7])).rows[0];
  check("G1 the copy links back without replacing", copy.source_document_id === q7 && copy.revision_of === null);
  const dCopy = await bill(copy.id);
  check("G2 the copy is billed on its own draft", dCopy.status === "draft" && dCopy.source_document_id === copy.id);
  const d7Row = (await c.query(`select count(*)::int n from public.documents where id = $1`, [d7.id])).rows[0];
  check("G3 the original's draft still stands — a copy retires nothing", d7Row?.n === 1, `count ${d7Row?.n}`);

  // ── H. the middle of the line ─────────────────────────────────────────────
  // q1→q2→q3 from A: the job accept left the line unbilled, so the middle can mint…
  const d2 = await bill(q2);
  check("H1 an unbilled mid-chain quote mints the line's bill", d2.status === "draft" && d2.source_document_id === q2);
  // …and the root, billed last, gets that same bill back rather than a rival.
  const rootBack = await bill(q1);
  check("H2 billing the root returns the mid-chain bill, not a rival", rootBack.id === d2.id, `${rootBack.id} vs ${d2.id}`);
  check("H3 the line holds exactly one bill across all four quotes", (await lineInvoiceCount([q1, q2, q3])) === 1);
} catch (e) {
  console.error("\n✗ threw:", e.message);
  failed = true;
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(failed ? "\n✗ FAILED" : "\n✓ all good — nothing written (rolled back)");
process.exit(failed ? 1 : 0);
