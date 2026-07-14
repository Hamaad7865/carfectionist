// Proves a quoted job's invoice inherits the quote — every line, priced, with its
// product link — instead of the blank Rs 0 line the old RPC invented. Runs inside a
// transaction and ROLLS BACK: nothing here survives.
//   node scripts/_verify-job-invoice.mjs
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh
requireEnv("SUPABASE_DB_URL", DB_URL);

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
await c.query("begin");

try {
  await c.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: OWNER, role: "authenticated" }),
  ]);

  const { rows: [ref] } = await c.query(
    `select c.id as customer_id, v.id as vehicle_id,
            (select id from products where is_active and selling_price > 0 order by name limit 1) as p1,
            (select id from products where is_active and selling_price > 0 order by name desc limit 1) as p2
       from customers c join vehicles v on v.customer_id = c.id limit 1`,
  );

  // A quote with TWO priced product lines — the thing the old code threw away.
  const { rows: [q] } = await c.query(
    `select (save_draft(
       jsonb_build_object('doc_type','quote','customer_id',$1::text,'vehicle_id',$2::text),
       jsonb_build_array(
         jsonb_build_object('product_id',$3::text,'title','Line one','qty',2,'unit_price',1000,'discount_pct',0,'vat_rate',15,'sort_order',0),
         jsonb_build_object('product_id',$4::text,'title','Line two','qty',1,'unit_price',500,'discount_pct',0,'vat_rate',15,'sort_order',1)
       ))).id as id`,
    [ref.customer_id, ref.vehicle_id, ref.p1, ref.p2],
  );
  await c.query("select issue_document(p_document_id => $1, p_idempotency_key => $2)", [q.id, `verify:${q.id}`]);

  const { rows: [job] } = await c.query("select (convert_quote_to_job($1, null, null)).id as id", [q.id]);

  // The moment of truth: bill the job.
  const { rows: [inv] } = await c.query(
    "select (create_document_from_job($1,'invoice')).id as id", [job.id],
  );

  const { rows: qLines } = await c.query(
    "select product_id, title, qty, unit_price from document_lines where document_id=$1 order by sort_order", [q.id],
  );
  const { rows: iLines } = await c.query(
    "select product_id, title, qty, unit_price from document_lines where document_id=$1 order by sort_order", [inv.id],
  );
  const { rows: [tot] } = await c.query(
    `select (select total_incl from documents where id=$1) as quote_total,
            (select total_incl from documents where id=$2) as invoice_total,
            (select source_document_id from documents where id=$2) as invoice_source`,
    [q.id, inv.id],
  );

  console.log("quote lines  :", JSON.stringify(qLines));
  console.log("invoice lines:", JSON.stringify(iLines));
  console.log("totals       :", JSON.stringify(tot));

  const fail = [];
  if (iLines.length !== qLines.length) fail.push(`invoice has ${iLines.length} lines, quote has ${qLines.length}`);
  if (iLines.some((l) => l.product_id == null)) fail.push("an invoice line lost its product link (no stock movement, no sales history)");
  if (Number(tot.invoice_total) !== Number(tot.quote_total)) fail.push(`invoice total ${tot.invoice_total} ≠ quote total ${tot.quote_total}`);
  if (iLines.some((l, i) => Number(l.unit_price) !== Number(qLines[i].unit_price) || Number(l.qty) !== Number(qLines[i].qty))) {
    fail.push("a price or quantity was not carried over");
  }
  if (tot.invoice_source !== q.id) fail.push("the invoice does not point back at its quote");

  if (fail.length) {
    console.log("\n✗ FAILED:\n  - " + fail.join("\n  - "));
    process.exitCode = 1;
  } else {
    console.log("\n✓ The job's invoice IS the quote: both lines, both prices, product links and lineage intact.");
  }
} catch (e) {
  console.error("✗ error:", e.message);
  process.exitCode = 1;
} finally {
  await c.query("rollback");
  await c.end();
  console.log("(rolled back — nothing kept)");
}
