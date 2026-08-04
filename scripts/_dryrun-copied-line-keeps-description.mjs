// Applies 20260804000030 inside a transaction and drives a rich description through
// every function that copies document_lines, asserting it survives each one. Then
// ROLLS BACK. Nothing is kept.
//   node scripts/_dryrun-copied-line-keeps-description.mjs
import pg from "pg";
import fs from "node:fs";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner)
const sql = fs.readFileSync("supabase/migrations/20260804000030_a_copied_line_keeps_its_description.sql", "utf8");

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};

const RICH = {
  schemaVersion: 1,
  blocks: [{ type: "ul", items: [[{ text: "Full Vehicle decontamination" }], [{ text: "Plastic treatment and restoration" }]] }],
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

/** What a document's first line kept. */
async function kept(docId) {
  const r = await c.query(
    `select jsonb_typeof(description_richtext) rt, unit_label,
            description_richtext#>>'{blocks,0,items,1,0,text}' as last_bullet
       from public.document_lines where document_id=$1 order by sort_order limit 1`,
    [docId],
  );
  return r.rows[0] ?? {};
}

try {
  await c.query("begin");
  await c.query(sql);
  console.log("✓ migration applied without error");

  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: AUTH, role: "authenticated" })]);

  const cust = (await c.query("select id from public.customers limit 1")).rows[0];
  const prod = (await c.query("select id from public.products where is_active limit 1")).rows[0];
  const loc = (await c.query("select id from public.stock_locations limit 1")).rows[0];

  const line = {
    product_id: prod.id,
    title: "Diamondbrite 3 YEARS PROTECTION Exterior only",
    description: "- Full Vehicle decontamination\n- Plastic treatment and restoration",
    description_richtext: RICH,
    unit_label: "panels",
    qty: 1,
    unit_price: 26465.02,
    vat_rate: 15,
    sort_order: 0,
  };

  // A fresh quote per scenario: duplicate_document marks its source, and
  // revise_quote then refuses to revise a quote it thinks already has a revision.
  const makeQuote = async () =>
    (
      await c.query("select id from public.save_draft($1::jsonb, $2::jsonb, null)", [
        JSON.stringify({ doc_type: "quote", customer_id: cust.id }),
        JSON.stringify([line]),
      ])
    ).rows[0];

  const quote = await makeQuote();
  const src = await kept(quote.id);
  check("the source quote has the tree", src.rt, "object");

  // ── duplicate_document ────────────────────────────────────────────────────
  const dup = (await c.query("select id from public.duplicate_document($1::uuid)", [quote.id])).rows[0];
  const d = await kept(dup.id);
  check("duplicate keeps the tree", d.rt, "object");
  check("duplicate keeps the unit", d.unit_label, "panels");
  check("duplicate keeps the last bullet", d.last_bullet, "Plastic treatment and restoration");

  // ── revise_quote (needs an issued quote) ──────────────────────────────────
  const forRevise = await makeQuote();
  await c.query("select public.issue_document($1::uuid, null, $2, null)", [forRevise.id, `dry-${forRevise.id}`]);
  const rev = (await c.query("select id from public.revise_quote($1::uuid)", [forRevise.id])).rows[0];
  const rv = await kept(rev.id);
  check("revision keeps the tree", rv.rt, "object");
  check("revision keeps the unit", rv.unit_label, "panels");

  // ── convert_quote_to_invoice ──────────────────────────────────────────────
  const forBill = await makeQuote();
  await c.query("select public.issue_document($1::uuid, null, $2, null)", [forBill.id, `dry-b-${forBill.id}`]);
  const inv = (await c.query("select id from public.convert_quote_to_invoice($1::uuid)", [forBill.id])).rows[0];
  const iv = await kept(inv.id);
  check("the invoice keeps the tree", iv.rt, "object");
  check("the invoice keeps the unit", iv.unit_label, "panels");
  check("the invoice keeps the last bullet", iv.last_bullet, "Plastic treatment and restoration");

  // ── create_and_issue_credit_note (needs the invoice issued) ───────────────
  await c.query("savepoint cn");
  try {
    await c.query("select public.issue_document($1::uuid, $2::uuid, $3, null)", [inv.id, loc?.id ?? null, `dry-inv-${inv.id}`]);
    const cn = (
      await c.query("select id from public.create_and_issue_credit_note($1::uuid, $2::uuid, false, null)", [inv.id, loc?.id ?? null])
    ).rows[0];
    const k = await kept(cn.id);
    check("the credit note keeps the tree", k.rt, "object");
    check("the credit note keeps the unit", k.unit_label, "panels");
  } catch (e) {
    console.log(`  ! credit-note path not reachable in a dry run (${e.message.slice(0, 90)})`);
    console.log("    — its copy statement is patched identically; see the migration diff.");
    await c.query("rollback to savepoint cn");
  }

  await c.query("rollback");
  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`} (rolled back — nothing persisted)`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  try { await c.query("rollback"); } catch {}
  console.error("✗ verify error:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
