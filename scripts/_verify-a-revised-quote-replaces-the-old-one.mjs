// Verifies 20260909000010_a_revised_quote_replaces_the_old_one.sql against the LIVE DB,
// all of it inside ONE BEGIN/ROLLBACK — the migration is loaded inside the txn, so
// neither the new column nor a single probe row survives. Nothing here can reach a
// real customer, and the live A00179/A00180 rows are only READ.
//
//   A. REVISE STAMPS IT — revise_quote writes revision_of alongside source_document_id,
//      and the copied lines keep their car (a three-car quote survives a revision).
//   B. THE GUARD — a second rival revision is still refused, but a plain COPY of a quote
//      no longer blocks revising the original (it used to, sharing source_document_id).
//   C. A COPY REPLACES NOTHING — duplicate_document leaves revision_of null, so the
//      original stays on the working list.
//   D. THE WORKING-LIST RULE — the predicate both clients use ("a quote with a live
//      revision is retired") hides the parent only once the revision stops being a
//      draft, and lets it back if that revision is voided.
//   E. THE BACKFILL — the eighteen historical quote→quote links are stamped, including
//      etienne gerare's A00179 → A00180, and no invoice or credit note was touched.
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import pg from "pg";
config({ path: ".env" });

const TENANT = "11111111-1111-4111-8111-000000000001";
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh's AUTH uid — goes in JWT claims
const MIGRATION = "supabase/migrations/20260909000010_a_revised_quote_replaces_the_old_one.sql";

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

// The rule the web list and the tablet's isRetired() both apply, in SQL.
const retiredParents = async () => {
  const { rows } = await c.query(
    `select distinct revision_of as id from public.documents
      where tenant_id = $1 and doc_type = 'quote'
        and revision_of is not null and status not in ('draft','void')`, [TENANT]);
  return new Set(rows.map((r) => r.id));
};

try {
  await c.query("begin");
  await asOwner();
  await c.query(readFileSync(MIGRATION, "utf8"));
  console.log("→ migration loaded inside the txn\n");

  const { rows: [cust] } = await c.query(
    `insert into public.customers (tenant_id, name, phone) values ($1, 'ZZ Probe Revise', '5000 0001') returning id`, [TENANT]);
  const { rows: [{ id: car1 }] } = await c.query(
    `insert into public.vehicles (tenant_id, customer_id, plate) values ($1, $2, 'ZZ REV 1') returning id`, [TENANT, cust.id]);
  const { rows: [{ id: car2 }] } = await c.query(
    `insert into public.vehicles (tenant_id, customer_id, plate) values ($1, $2, 'ZZ REV 2') returning id`, [TENANT, cust.id]);

  const line = (title, price, vehicle_id, sort) =>
    ({ title, qty: 1, unit_price: price, vat_rate: 15, sort_order: sort, line_kind: "service", vehicle_id });

  // ── A. revise stamps it, and the cars survive ─────────────────────────────
  const { rows: [quote] } = await c.query(
    `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "quote", customer_id: cust.id, vehicle_id: car1 }),
     JSON.stringify([line("Detail — car 1", 3000, car1, 0), line("Detail — car 2", 2000, car2, 1)])]);
  await c.query(`select * from public.issue_document($1, null, null, null)`, [quote.id]);

  const { rows: [rev] } = await c.query(`select * from public.revise_quote($1)`, [quote.id]);
  check("A1 the revision points at the quote it replaces", rev.revision_of === quote.id, String(rev.revision_of));
  check("A2 source_document_id is still set (the copy chain is unchanged)", rev.source_document_id === quote.id);
  check("A3 the revision starts as a draft", rev.status === "draft", rev.status);
  const { rows: revLines } = await c.query(
    `select title, vehicle_id from public.document_lines where document_id = $1 order by sort_order`, [rev.id]);
  check("A4 both lines were copied", revLines.length === 2, `${revLines.length}`);
  check("A5 each copied line KEEPS its car", revLines[0]?.vehicle_id === car1 && revLines[1]?.vehicle_id === car2,
    revLines.map((l) => l.vehicle_id).join());

  // ── B. the guard ──────────────────────────────────────────────────────────
  // A raise poisons the whole txn, so every expected failure runs under its own savepoint.
  const refuses = async (sql, args) => {
    await c.query("savepoint probe");
    try { await c.query(sql, args); await c.query("release savepoint probe"); return false; }
    catch { await c.query("rollback to savepoint probe"); return true; }
  };

  const secondRevisionRefused = await refuses(`select * from public.revise_quote($1)`, [quote.id]);
  check("B1 a second rival revision is refused", secondRevisionRefused);

  const { rows: [plain] } = await c.query(
    `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "quote", customer_id: cust.id, vehicle_id: car1 }),
     JSON.stringify([line("Wash", 500, car1, 0)])]);
  await c.query(`select * from public.issue_document($1, null, null, null)`, [plain.id]);
  await c.query(`select * from public.duplicate_document($1)`, [plain.id]); // a COPY, not a revision
  const copyBlockedRevision = await refuses(`select * from public.revise_quote($1)`, [plain.id]);
  check("B2 a plain COPY no longer blocks revising the original", !copyBlockedRevision);

  // ── C. a copy replaces nothing ────────────────────────────────────────────
  const { rows: [copyRow] } = await c.query(
    `select revision_of, source_document_id from public.documents
      where source_document_id = $1 and revision_of is null order by created_at limit 1`, [plain.id]);
  check("C1 the copy carries source_document_id but NOT revision_of",
    copyRow?.source_document_id === plain.id && copyRow?.revision_of === null);

  // ── D. the working-list rule ──────────────────────────────────────────────
  let retired = await retiredParents();
  check("D1 a DRAFT revision does not retire its parent yet", !retired.has(quote.id));
  await c.query(`select * from public.issue_document($1, null, null, null)`, [rev.id]);
  retired = await retiredParents();
  check("D2 once the revision goes out, the parent is retired", retired.has(quote.id));
  check("D3 the copied-from quote is NOT retired by its copy", !retired.has(plain.id));
  // void_document is for bills; a quote reaches 'void' through cancel_job, so the
  // status is set straight here — the rule under test reads the status, not the route.
  await c.query(`update public.documents set status = 'void' where id = $1`, [rev.id]);
  retired = await retiredParents();
  check("D4 voiding the revision puts the parent back on the list", !retired.has(quote.id));

  // ── E. the backfill ───────────────────────────────────────────────────────
  // The probe's own copy is deliberately unstamped (C1), so the history is counted
  // without it — every OTHER quote→quote link predates this run and must be stamped.
  const { rows: [{ n: unstamped }] } = await c.query(
    `select count(*)::int n from public.documents c join public.documents p on p.id = c.source_document_id
      where c.doc_type = 'quote' and p.doc_type = 'quote' and c.revision_of is null
        and c.customer_id is distinct from $1`, [cust.id]);
  check("E1 every historical quote→quote link is stamped", unstamped === 0, `${unstamped} left`);
  const { rows: [pair] } = await c.query(
    `select c.number child, p.number parent from public.documents c join public.documents p on p.id = c.revision_of
      where c.number = 'A00180' and c.tenant_id = $1`, [TENANT]);
  check("E2 etienne gerare's A00180 now replaces A00179", pair?.parent === "A00179", `${pair?.parent} → ${pair?.child}`);
  const { rows: [{ n: wrongType }] } = await c.query(
    `select count(*)::int n from public.documents where revision_of is not null and doc_type <> 'quote'`);
  check("E3 no invoice or credit note was stamped", wrongType === 0, `${wrongType}`);
} catch (e) {
  console.error("\n✗ threw:", e.message);
  failed = true;
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(failed ? "\n✗ FAILED" : "\n✓ all good — nothing written (rolled back)");
process.exit(failed ? 1 : 0);
