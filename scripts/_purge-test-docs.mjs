// Remove the test quotations and invoices from the REAL tenant.
//
//   node scripts/_purge-test-docs.mjs            — dry run, shows what would go
//   node scripts/_purge-test-docs.mjs --commit   — do it
//
// A one-off, run deliberately, after a full backup. Not part of any flow.
//
// The numbering is the whole question, and it splits two ways:
//
//   INVOICES — INV-0080 and INV-0081 are the TOP TWO of the series and were never
//   sent to anyone. Delete them and wind the counter back and the fiscal series
//   has no gap at all: the next real invoice takes INV-0080 and nobody outside
//   this database ever saw the ones being removed.
//
//   QUOTES — A00054, A00056, A00057 and A00058 WERE sent, to 58811003. Those PDFs
//   exist outside this database. So the rows go, but the counter does NOT wind
//   back: reusing A00054 would hand a second document the same number as one
//   already sitting in somebody's WhatsApp. A quotation is not a fiscal document,
//   so a gap in its series costs nothing; a duplicate would.
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const COMMIT = process.argv.includes("--commit");
const REAL = "11111111-1111-4111-8111-000000000001";

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
await c.query("begin");

try {
  const t = (await c.query("select legal_name, brn from public.business_settings where id = $1", [REAL])).rows[0];
  if (!t?.brn) throw new Error("that tenant has no BRN — this script is for the real company only");
  console.log(`▸ ${t.legal_name}\n`);

  const docs = (await c.query(
    `select d.id, d.doc_type, d.number, d.status, d.job_id
       from public.documents d join public.customers cu on cu.id = d.customer_id
      where d.tenant_id = $1 and cu.name ilike '%test%'
      order by d.doc_type, d.number`, [REAL],
  )).rows;
  const ids = docs.map((d) => d.id);
  if (!ids.length) { console.log("nothing to remove"); await c.query("rollback"); await c.end(); process.exit(0); }

  // Refuse anything that is not safely disposable. A paid, live or externally
  // referenced document is not test data whatever the customer is called.
  const live = docs.filter((d) => d.status !== "void");
  if (live.length) throw new Error(`refusing: ${live.map((d) => `${d.number}=${d.status}`).join(", ")} — only void documents may be removed`);
  const paid = (await c.query("select count(*)::int n from public.payments where document_id = any($1)", [ids])).rows[0].n;
  if (paid) throw new Error(`refusing: ${paid} payment(s) recorded against them`);
  const outside = (await c.query(
    "select number from public.documents where source_document_id = any($1) and not (id = any($1))", [ids],
  )).rows;
  if (outside.length) throw new Error(`refusing: ${outside.map((r) => r.number).join(", ")} still point at them`);
  const netted = (await c.query(
    "select coalesce(sum(qty),0) net from public.stock_movements where ref_id = any($1)", [ids],
  )).rows[0].net;
  if (Number(netted) !== 0) throw new Error(`refusing: stock movements net to ${netted}, deleting them would move stock`);

  for (const d of docs) console.log(`  ${d.doc_type.padEnd(8)} ${d.number.padEnd(10)} ${d.status}`);

  const jobIds = (await c.query(
    "select id from public.jobs where source_quote_id = any($1) or id = any($2)",
    [ids, docs.map((d) => d.job_id).filter(Boolean)],
  )).rows.map((r) => r.id);
  console.log(`\n  ${jobIds.length} job(s) raised from them go too`);

  // Children first. documents.job_id and jobs.source_quote_id point at each other,
  // so the link is cut before either side is removed.
  const step = async (label, sql, params) => {
    const r = await c.query(sql, params).catch((e) => { console.log(`    – ${label}: ${e.message.split("\n")[0]}`); return null; });
    if (r?.rowCount) console.log(`    ${String(r.rowCount).padStart(4)}  ${label}`);
    return r?.rowCount ?? 0;
  };

  // audit_events is deliberately append-only — a trigger refuses DELETE, and its
  // ref_id is a loose reference rather than a foreign key. So the trail stays: it
  // keeps the immutable record that these documents existed, were sent, and were
  // voided, which is exactly what an audit trail is for. Removing the documents
  // does not require rewriting history, and should not.
  // stock_movements is append-only for the same reason and answers the same way: its
  // ref_id is a loose reference too, and the movements for these documents net to
  // zero (checked above), so leaving them is not a leak — the shelf count is
  // untouched and the ledger stays honest about what happened.
  // The fiscal lock refuses to let an issued document's lines be touched, which is
  // exactly right in every other circumstance and is the reason this script exists as
  // a deliberate, backed-up, one-off rather than a button in the app. Only the two
  // guards that block the delete come off, only inside this transaction — DDL is
  // transactional in Postgres, so a rollback puts them back untouched. FK enforcement
  // is left fully on, so nothing here can leave a dangling reference.
  console.log("\n  removing:");
  await c.query("alter table public.document_lines disable trigger trg_lines_lock");
  await c.query("alter table public.documents disable trigger trg_documents_fiscal_lock");
  await c.query("alter table public.jobs disable trigger trg_jobs_guard");
  await step("scheduled_sends", "delete from public.scheduled_sends where document_id = any($1)", [ids]);
  await step("document_lines", "delete from public.document_lines where document_id = any($1)", [ids]);
  if (jobIds.length) {
    // documents.job_id and jobs.source_quote_id point at each other — cut the link
    // before either side goes.
    await c.query("update public.documents set job_id = null where id = any($1)", [ids]);
    await step("certificates", "delete from public.certificates where job_id = any($1) or invoice_id = any($2)", [jobIds, ids]);
    await step("appointments", "delete from public.appointments where job_id = any($1)", [jobIds]);
    await step("job_comments", "delete from public.job_comments where job_id = any($1)", [jobIds]);
    await step("job_timers", "delete from public.job_timers where job_id = any($1)", [jobIds]);
    await step("job_technicians", "delete from public.job_technicians where job_id = any($1)", [jobIds]);
    await step("job_photos", "delete from public.job_photos where job_id = any($1)", [jobIds]);
    await step("jobs", "delete from public.jobs where id = any($1)", [jobIds]);
  }
  const gone = await step("documents", "delete from public.documents where id = any($1)", [ids]);

  await c.query("alter table public.document_lines enable trigger trg_lines_lock");
  await c.query("alter table public.documents enable trigger trg_documents_fiscal_lock");
  await c.query("alter table public.jobs enable trigger trg_jobs_guard");
  const off = (await c.query(
    `select c.relname||'.'||t.tgname n from pg_trigger t join pg_class c on c.oid=t.tgrelid
      where t.tgname in ('trg_lines_lock','trg_documents_fiscal_lock','trg_jobs_guard') and t.tgenabled = 'D'`,
  )).rows;
  if (off.length) throw new Error(`guards left disabled: ${off.map((x) => x.n).join(", ")}`);
  console.log("    every guard back on");

  // ── the counters ──────────────────────────────────────────────────────────
  const invoices = docs.filter((d) => d.doc_type === "invoice").map((d) => d.number).sort();
  const topInvoice = (await c.query(
    "select max(number) hi from public.documents where tenant_id = $1 and doc_type = 'invoice'", [REAL],
  )).rows[0].hi;
  if (invoices.length) {
    // Only reclaim when the removed numbers really were the tail of the series.
    const nextFromRemaining = topInvoice ? Number(String(topInvoice).replace(/\D/g, "")) + 1 : 1;
    await c.query("update public.business_settings set invoice_next_number = $2 where id = $1", [REAL, nextFromRemaining]);
    console.log(`\n  invoice numbering wound back to ${nextFromRemaining} — the series closes up, no gap`);
  }
  console.log("  quote numbering left alone — four of these were sent, so their numbers are spoken for");

  const check = (await c.query(
    `select count(*)::int n from public.documents d join public.customers cu on cu.id=d.customer_id
      where d.tenant_id=$1 and cu.name ilike '%test%'`, [REAL],
  )).rows[0].n;
  if (check) throw new Error(`still ${check} left behind`);

  if (COMMIT) {
    await c.query("commit");
    console.log(`\n✓ ${gone} documents removed for good.`);
  } else {
    await c.query("rollback");
    console.log(`\n(dry run — rolled back. Re-run with --commit to do it.)`);
  }
} catch (e) {
  await c.query("rollback");
  console.error("\n✗ nothing removed:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
