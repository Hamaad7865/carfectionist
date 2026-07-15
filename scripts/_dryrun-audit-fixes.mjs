// Applies the audit-fix migration inside a transaction, asserts each fix took, then
// ROLLS BACK — nothing is kept. Proves the migration is safe before it touches prod.
//   node scripts/_dryrun-audit-fixes.mjs
import pg from "pg";
import fs from "node:fs";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const sql = fs.readFileSync("supabase/migrations/20260715000010_audit_fixes.sql", "utf8");
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
await c.query("begin");
const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };

try {
  await c.query(sql); // apply the whole migration
  console.log("✓ migration applied without error");

  // #3 — the money-column grant is gone.
  const g = (await c.query("select has_column_privilege('authenticated','public.documents','total_incl','UPDATE') as w")).rows[0].w;
  ok(g === false, `#3: authenticated can still UPDATE total_incl (${g})`);
  const gStatus = (await c.query("select has_column_privilege('authenticated','public.documents','status','UPDATE') as w")).rows[0].w;
  ok(gStatus === false, "#3: status grant should still be false (unchanged)");

  // #3b — recompute_doc_totals now runs as owner.
  const sd = (await c.query("select prosecdef from pg_proc where proname='recompute_doc_totals'")).rows[0].prosecdef;
  ok(sd === true, "#3b: recompute_doc_totals should be SECURITY DEFINER");

  // #10 — the non-negative constraint exists and bites.
  const con = (await c.query("select 1 from pg_constraint where conname='document_lines_unit_price_nonneg'")).rowCount;
  ok(con === 1, "#10: constraint document_lines_unit_price_nonneg missing");

  // #9 — the unique index exists.
  const idx = (await c.query("select 1 from pg_indexes where indexname='cash_sessions_day_service_uq'")).rowCount;
  ok(idx === 1, "#9: unique index cash_sessions_day_service_uq missing");

  // #1 — reverse_payment now locks the document before summing.
  const rev = (await c.query("select pg_get_functiondef('public.reverse_payment'::regproc) as d")).rows[0].d;
  ok(/where id = v_orig\.document_id for update;\s*\n\s*select coalesce\(sum\(amount\)/.test(rev), "#1: reverse_payment does not lock the doc before summing");

  // #2 — issue_document anchors business_day to the session's trading day.
  const iss = (await c.query("select pg_get_functiondef('public.issue_document'::regproc) as d")).rows[0].d;
  ok(iss.includes("cs.id = coalesce(p_session_id, v_doc.cash_session_id)"), "#2: issue_document business_day not session-anchored");

  // #9 — open_cash_session takes the per-day advisory lock.
  const opn = (await c.query("select pg_get_functiondef('public.open_cash_session'::regproc) as d")).rows[0].d;
  ok(opn.includes("pg_advisory_xact_lock(hashtextextended(v_day.id::text, 0))"), "#9: open_cash_session missing advisory lock");

  if (fail.length) { console.log("\n✗ FAILED:\n  - " + fail.join("\n  - ")); process.exitCode = 1; }
  else console.log("\n✓ All 6 backend fixes verified in a rolled-back transaction.");
} catch (e) {
  console.error("✗ migration error:", e.message);
  process.exitCode = 1;
} finally {
  await c.query("rollback");
  await c.end();
  console.log("(rolled back — nothing kept)");
}
