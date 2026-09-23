// Verifies 20260910000120_revise_hardening.sql (and the 110 in-place cut beneath it)
// against the LIVE DB, all inside ONE BEGIN/ROLLBACK — the migration is loaded
// inside the txn, so neither the new bodies nor a single probe row survives.
//
//   A. REOPEN, NOT REWRITE — revise_quote returns the SAME row, same number, same
//      status, signature untouched, audit written. No second row. Revise-then-back
//      changes nothing.
//   B. DRAFT IDEMPOTENT — revising a draft hands it back; no fork beside it.
//   C. EDIT IN PLACE — save_draft persists line edits onto an issued quote, keeps
//      the number, and the first save un-signs an accepted one (→ issued, null).
//   D. STILL REFUSED — declined quotes, quotes under any live bill (draft bill
//      included), delivered-job quotes, and issued INVOICES on save_draft.
//   E. HARDENING — a fully-credited bill retires (revise+edit allowed again);
//      doc_type flip, customer re-point and job move refused on issued quotes;
//      over-allowance discounts refused on issued saves; amend saves are audited.
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import pg from "pg";
config({ path: ".env" });

const TENANT = "11111111-1111-4111-8111-000000000001";
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh's AUTH uid — goes in JWT claims
const MIGRATION = "supabase/migrations/20260910000130_revise_keeps_the_agreement.sql";

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
const refuses = async (sql, args) => {
  await c.query("savepoint probe");
  try { await c.query(sql, args); await c.query("release savepoint probe"); return false; }
  catch { await c.query("rollback to savepoint probe"); return true; }
};

try {
  await c.query("begin");
  await asOwner();
  await c.query(readFileSync(MIGRATION, "utf8"));
  console.log("→ migration loaded inside the txn\n");

  const { rows: [cust] } = await c.query(
    `insert into public.customers (tenant_id, name, phone) values ($1, 'ZZ Probe Harden', '5000 0003') returning id`, [TENANT]);
  const { rows: [{ id: car }] } = await c.query(
    `insert into public.vehicles (tenant_id, customer_id, plate) values ($1, $2, 'ZZ HRD 1') returning id`, [TENANT, cust.id]);
  const line = (title, price, sort) =>
    ({ title, qty: 1, unit_price: price, vat_rate: 15, sort_order: sort, line_kind: "service", vehicle_id: car });
  const mkQuote = async (lines) => (await c.query(
    `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "quote", customer_id: cust.id, vehicle_id: car }), JSON.stringify(lines)])).rows[0];
  const editLines = (id, lines, extra = {}) => c.query(
    `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "quote", id, customer_id: cust.id, vehicle_id: car, ...extra }), JSON.stringify(lines)]);
  const countMine = async () => (await c.query(
    `select count(*)::int n from public.documents where tenant_id = $1 and customer_id = $2`, [TENANT, cust.id])).rows[0].n;

  // ── A. reopen, not rewrite ────────────────────────────────────────────
  const q = await mkQuote([line("Detail", 3000, 0), line("Wax", 500, 1)]);
  await c.query(`select * from public.issue_document($1, null, null, null)`, [q.id]);
  await c.query(`select * from public.accept_quote($1, $2)`, [q.id, JSON.stringify({ via: "test" })]);
  const before = (await c.query(`select id, number, status, accepted_signature is not null as s from public.documents where id = $1`, [q.id])).rows[0];
  const n0 = await countMine();
  const { rows: [rev] } = await c.query(`select * from public.revise_quote($1)`, [q.id]);
  check("A1 revise hands back the SAME row", rev.id === q.id, `${rev.id} vs ${q.id}`);
  check("A2 the number is kept", rev.number === before.number, String(rev.number));
  check("A3 press changes nothing (still accepted+signed)", rev.status === "accepted" && rev.accepted_signature != null, rev.status);
  check("A4 no second row was forked", (await countMine()) === n0);
  const { rows: [audit] } = await c.query(
    `select * from public.audit_events where tenant_id = $1 and event_type = 'quote_revised_in_place' and ref_id = $2`, [TENANT, q.id]);
  check("A5 the reopen is audited", !!audit);

  // ── B. draft idempotent ───────────────────────────────────────────────
  const d = await mkQuote([line("Wash", 400, 0)]);
  const n1 = await countMine();
  const { rows: [rd] } = await c.query(`select * from public.revise_quote($1)`, [d.id]);
  check("B1 a draft comes straight back", rd.id === d.id);
  check("B2 no second draft beside it", (await countMine()) === n1);

  // ── C. the save keeps the agreement ─────────────────────────────────────
  await c.query(`select * from public.set_quote_booking($1, now() + interval '2 days', 1000)`, [q.id]);
  await editLines(q.id, [line("Detail", 3500, 0), line("Wax", 500, 1)]);
  const after = (await c.query(`select number, status, total_incl, accepted_signature is not null as s, book_for_at is not null as b, deposit_due from public.documents where id = $1`, [q.id])).rows[0];
  check("C1 the number never moves", after.number === before.number, String(after.number));
  check("C2 the new price stands (no fork to bill)", Number(after.total_incl) === 4600, String(after.total_incl));
  check("C3 accepted STAYS accepted — no re-sign ceremony", after.status === "accepted", after.status);
  check("C4 the signature is carried, not cleared", after.s === true);
  check("C5 booking time + deposit are carried", after.b === true && Number(after.deposit_due) === 1000, JSON.stringify({ b: after.b, deposit_due: after.deposit_due }));
  const { rows: [audit2] } = await c.query(
    `select payload from public.audit_events where tenant_id = $1 and event_type = 'quote_edited_in_place' and ref_id = $2`, [TENANT, q.id]);
  check("C6 the amend save is audited with old+new totals",
    !!audit2 && Number(audit2.payload.was_total) === 4025 && Number(audit2.payload.total) === 4600, JSON.stringify(audit2?.payload));

  // ── D. the guards ─────────────────────────────────────────────────────
  const dead = await mkQuote([line("Wash", 400, 0)]);
  await c.query(`select * from public.issue_document($1, null, null, null)`, [dead.id]);
  await c.query(`select * from public.decline_quote($1, $2)`, [dead.id, "too dear"]);
  check("D1 a declined quote cannot be revised", await refuses(`select * from public.revise_quote($1)`, [dead.id]));
  check("D2 a declined quote cannot be edited", await refuses(
    `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "quote", id: dead.id, customer_id: cust.id, vehicle_id: car }), JSON.stringify([line("Wash", 100, 0)])]));

  // A DRAFT bill already fences the quote (else the bill goes stale).
  const billing = await mkQuote([line("Polish", 2000, 0)]);
  await c.query(`select * from public.issue_document($1, null, null, null)`, [billing.id]);
  await c.query(`select * from public.convert_quote_to_invoice($1)`, [billing.id]); // draft bill
  check("D3 a quote with a draft bill cannot be revised", await refuses(`select * from public.revise_quote($1)`, [billing.id]));
  check("D4 a quote with a draft bill cannot be edited", await refuses(
    `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "quote", id: billing.id, customer_id: cust.id, vehicle_id: car }), JSON.stringify([line("Polish", 1, 0)])]));

  const billed = await mkQuote([line("Coating", 2000, 0)]);
  await c.query(`select * from public.issue_document($1, null, null, null)`, [billed.id]);
  const { rows: [inv] } = await c.query(`select * from public.convert_quote_to_invoice($1)`, [billed.id]);
  await c.query(`select * from public.issue_document($1, null, null, null)`, [inv.id]);
  check("D5 a billed quote cannot be revised", await refuses(`select * from public.revise_quote($1)`, [billed.id]));
  check("D6 an issued INVOICE still refuses save_draft", await refuses(
    `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "invoice", id: inv.id, customer_id: cust.id, vehicle_id: car }), JSON.stringify([line("Coating", 2000, 0)])]));

  // ── E. hardening ──────────────────────────────────────────────────────
  const { rows: [{ id: till }] } = await c.query(`select * from public.back_office_till()`);
  await c.query(`select * from public.create_and_issue_credit_note($1, null, false, $2)`, [inv.id, till]);
  const { rows: [revB] } = await c.query(`select * from public.revise_quote($1)`, [billed.id]);
  check("E1 a fully-credited bill retires — revise allowed again", revB.id === billed.id);
  await editLines(billed.id, [line("Coating", 2100, 0)]);
  check("E2 …and so is editing", true);

  check("E3 doc_type cannot flip on an issued quote", await refuses(
    `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "invoice", id: q.id, customer_id: cust.id, vehicle_id: car }), JSON.stringify([line("Detail", 3500, 0)])]));
  const { rows: [cust2] } = await c.query(
    `insert into public.customers (tenant_id, name, phone) values ($1, 'ZZ Probe Other', '5000 0004') returning id`, [TENANT]);
  check("E4 customer cannot re-point on an issued quote", await refuses(
    `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "quote", id: q.id, customer_id: cust2.id, vehicle_id: car }), JSON.stringify([line("Detail", 3500, 0)])]));

  // Service-only quote, 50% order discount, no reason: past every allowance.
  const svc = await mkQuote([line("Detail", 4000, 0)]);
  await c.query(`select * from public.issue_document($1, null, null, null)`, [svc.id]);
  check("E5 over-allowance discount refused on an issued save", await refuses(
    `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "quote", id: svc.id, customer_id: cust.id, vehicle_id: car, discount_kind: "percent", discount_value: 50 }),
     JSON.stringify([line("Detail", 4000, 0)])]));
  await editLines(svc.id, [line("Detail", 4100, 0)]);
  check("E6 a compliant edit still passes", true);
} catch (e) {
  console.error("\n✗ threw:", e.message);
  failed = true;
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(failed ? "\n✗ FAILED" : "\n✓ all good — nothing written (rolled back)");
process.exit(failed ? 1 : 0);
