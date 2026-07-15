// Generates the audit-fix migration by fetching each function's AUTHORITATIVE body
// from the live DB and applying one surgical replacement — so a 120-line fiscal
// function stays byte-for-byte itself except the single line we mean to change.
//   node scripts/_gen-bugfix-migration.mjs
import pg from "pg";
import fs from "node:fs";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

async function body(fn) {
  const { rows } = await c.query(`select pg_get_functiondef($1::regproc) as def`, [fn]);
  return rows[0].def;
}
function replaceOnce(src, find, repl, label) {
  const i = src.indexOf(find);
  if (i === -1) throw new Error(`[${label}] anchor not found: ${find.slice(0, 60)}`);
  if (src.indexOf(find, i + 1) !== -1) throw new Error(`[${label}] anchor not unique: ${find.slice(0, 60)}`);
  return src.slice(0, i) + repl + src.slice(i + find.length);
}

// ── #1 reverse_payment: lock the document BEFORE summing, mirroring record_payment ──
let reverse = await body("public.reverse_payment");
reverse = replaceOnce(
  reverse,
  `  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = v_orig.document_id;\n  select * into v_doc from public.documents where id = v_orig.document_id;`,
  `  -- Lock the document BEFORE summing so a concurrent record_payment/reverse_payment on\n  -- the same invoice cannot lose an update to amount_paid/status (audit finding #1).\n  select * into v_doc from public.documents where id = v_orig.document_id for update;\n  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = v_orig.document_id;`,
  "reverse_payment",
);

// ── #2 issue_document: a till-rung doc's business day is its SESSION's trading day, ──
//     not the wall clock, so a post-midnight sale still folds into the day it belongs to.
let issue = await body("public.issue_document");
issue = replaceOnce(
  issue,
  `    business_day       = coalesce(v_doc.business_day, app.mu_today()),`,
  `    business_day       = coalesce(\n                           v_doc.business_day,\n                           -- A sale rung after local midnight on a till opened before it\n                           -- belongs to that till's trading day, not today (audit #2).\n                           (select td.business_date\n                              from public.cash_sessions cs\n                              join public.trading_days td on td.id = cs.trading_day_id\n                             where cs.id = coalesce(p_session_id, v_doc.cash_session_id)),\n                           app.mu_today()),`,
  "issue_document",
);

// ── #9 open_cash_session: serialize per trading day so two opens can't share a number ──
let openSess = await body("public.open_cash_session");
openSess = replaceOnce(
  openSess,
  `  select coalesce(max(service_no), 0) + 1 into v_no\n    from public.cash_sessions where trading_day_id = v_day.id;`,
  `  -- Two devices opening a till at the same instant would both read the same max and\n  -- mint the same service_no; serialize per day (audit #9). The unique index below is\n  -- the hard backstop.\n  perform pg_advisory_xact_lock(hashtextextended(v_day.id::text, 0));\n  select coalesce(max(service_no), 0) + 1 into v_no\n    from public.cash_sessions where trading_day_id = v_day.id;`,
  "open_cash_session",
);

const header = `-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — fixes from the adversarial production bug audit
--
-- Five backend defects, each confirmed against the live schema before writing:
--   #1  reverse_payment did not lock the document before recomputing amount_paid,
--       so a concurrent payment/reversal on one invoice was a lost update.
--   #2  a sale rung after local midnight on a still-open till was dropped from the
--       DAY Z-report's sales/VAT/tickets while its cash was still counted — the slip
--       no longer balanced. Anchor the doc's business day to its session's trading day.
--   #3  'authenticated' retained column-level UPDATE on documents.total_incl /
--       subtotal_excl / vat_total (the residue the earlier lock migration missed),
--       so any staff could rewrite a draft invoice's money and freeze it on issue.
--   #9  open_cash_session raced two tills to the same service number.
--   #10 an ad-hoc line accepted a negative unit price → a negative-total invoice.
--
-- The three function bodies below are the LIVE definitions, reproduced verbatim by
-- pg_get_functiondef with exactly one surgical change each (generated, not hand-typed).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── #3: revoke the residual money-column write grant ─────────────────────────
revoke update (subtotal_excl, vat_total, total_incl) on public.documents from authenticated;
-- Belt-and-suspenders: the sole legitimate writer runs as owner regardless of caller.
alter function app.recompute_doc_totals(uuid) security definer set search_path = public, pg_temp;

-- ── #10: no line may carry a negative unit price, on any path ─────────────────
alter table public.document_lines drop constraint if exists document_lines_unit_price_nonneg;
alter table public.document_lines add constraint document_lines_unit_price_nonneg check (unit_price >= 0);

-- ── #9 backstop: one service number per (tenant, trading day) ─────────────────
create unique index if not exists cash_sessions_day_service_uq on public.cash_sessions (tenant_id, trading_day_id, service_no);

`;

const out = [header, "-- ── #1 ──", reverse, ";", "", "-- ── #2 ──", issue, ";", "", "-- ── #9 ──", openSess, ";", ""].join("\n");
const path = "supabase/migrations/20260715000010_audit_fixes.sql";
fs.writeFileSync(path, out);
console.log("wrote", path, `(${out.length} chars)`);
await c.end();
