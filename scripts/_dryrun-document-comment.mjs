// Applies 20260715000030_document_comment.sql inside a transaction, exercises the
// comment through save_draft (quote + full invoice→issue path), asserts it persists
// and is frozen at issue, then ROLLS BACK. Nothing is kept.
//   node scripts/_dryrun-document-comment.mjs
import pg from "pg";
import fs from "node:fs";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner auth uid)
const sql = fs.readFileSync("supabase/migrations/20260715000030_document_comment.sql", "utf8");

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");

  // Apply the migration as the connection's (owner) role — ALTER/CREATE need it.
  await c.query(sql);
  console.log("✓ migration applied without error");

  // column exists + is nullable text
  const col = (await c.query(
    "select data_type, is_nullable from information_schema.columns where table_name='documents' and column_name='comment'"
  )).rows[0];
  check("documents.comment is text", col?.data_type, "text");
  check("documents.comment nullable", col?.is_nullable, "YES");

  // Now impersonate the owner (authenticated + JWT claims) for the RPC calls.
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: AUTH, role: "authenticated" })]);

  // ── quote path: comment captured, preserved, updated, cleared ──────────────
  const q1 = (await c.query("select id, comment from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ doc_type: "quote", comment: "  Customer will collect Friday PM  " }),
    JSON.stringify([{ title: "Detailing", qty: 1, unit_price: 1000, vat_rate: 15 }]),
  ])).rows[0];
  check("quote stores comment (trimmed by nullif? no — kept verbatim)", q1.comment, "  Customer will collect Friday PM  ");
  const qid = q1.id;

  // update omitting the comment key → must PRESERVE existing comment
  const q2 = (await c.query("select comment from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ id: qid, doc_type: "quote" }),
    JSON.stringify([{ title: "Detailing", qty: 1, unit_price: 1200, vat_rate: 15 }]),
  ])).rows[0];
  check("omitting comment key preserves it", q2.comment, "  Customer will collect Friday PM  ");

  // update with a new comment → replaces
  const q3 = (await c.query("select comment from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ id: qid, doc_type: "quote", comment: "Paid deposit in cash" }),
    JSON.stringify([{ title: "Detailing", qty: 1, unit_price: 1200, vat_rate: 15 }]),
  ])).rows[0];
  check("new comment replaces", q3.comment, "Paid deposit in cash");

  // update with empty string → nullif clears to null
  const q4 = (await c.query("select comment from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ id: qid, doc_type: "quote", comment: "" }),
    JSON.stringify([{ title: "Detailing", qty: 1, unit_price: 1200, vat_rate: 15 }]),
  ])).rows[0];
  check("empty-string comment clears to null", q4.comment, null);

  // save_draft with NO comment anywhere still works (regression) → null
  const q5 = (await c.query("select comment from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ doc_type: "quote" }),
    JSON.stringify([{ title: "Wash", qty: 1, unit_price: 300, vat_rate: 15 }]),
  ])).rows[0];
  check("plain save_draft (no comment) → null, no error", q5.comment, null);

  // ── invoice path: comment survives issue and is then frozen ────────────────
  const cust = (await c.query("select id from public.customers limit 1")).rows[0];
  const prod = (await c.query("select id from public.products where is_active limit 1")).rows[0];
  if (!cust || !prod) {
    console.log("  ! no live customer/product visible — skipping invoice-issue path");
  } else {
    const inv = (await c.query("select id, comment from public.save_draft($1::jsonb, $2::jsonb, null)", [
      JSON.stringify({ doc_type: "invoice", customer_id: cust.id, comment: "Internal: staff discount approved by Anesh" }),
      JSON.stringify([{ product_id: prod.id, title: "Item", qty: 1, unit_price: 1000, vat_rate: 15 }]),
    ])).rows[0];
    check("invoice draft stores comment", inv.comment, "Internal: staff discount approved by Anesh");

    await c.query("select public.issue_document($1::uuid, null, null)", [inv.id]);
    const issued = (await c.query("select status, comment from public.documents where id=$1", [inv.id])).rows[0];
    check("comment survives issue", issued.comment, "Internal: staff discount approved by Anesh");
    check("document is now issued", issued.status, "issued");

    // fiscal lock: trying to change the comment on an issued invoice must be refused
    try {
      await c.query("savepoint f1");
      await c.query("update public.documents set comment='tampered' where id=$1", [inv.id]);
      check("issued-invoice comment is frozen", "allowed", "rejected");
      await c.query("rollback to savepoint f1");
    } catch {
      await c.query("rollback to savepoint f1");
      check("issued-invoice comment is frozen", "rejected", "rejected");
    }
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
