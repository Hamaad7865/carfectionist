// Proves a revision can no longer leave a live bill behind.
//
// The shape that got through in the shop on 2026-09-02: a goods-only quote is
// accepted at the counter, which bills and ISSUES it in the same breath (stock
// off the shelf), and is then revised. The old bill was never voided, never
// credited, attached to no job — so it stayed on the sales journal as revenue,
// on the customer's statement as a receivable, and its stock movement stood
// while the replacement bill was ready to take the same goods again.
//
// Four things must hold:
//   1. a quote carrying a LIVE, job-less bill refuses to be revised;
//   2. a DRAFT bill refuses nothing — that is the everyday case;
//   3. the revision cannot be billed over the standing one either;
//   4. a draft bill raised BEFORE the old one was issued still cannot be issued
//      over it — the shape that exists in the shop right now;
//   and all of it clears the moment the old bill is voided.
//
// Runs inside a transaction and ROLLS BACK — nothing here survives.
//   node scripts/_verify-revise-a-billed-quote.mjs
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b";
requireEnv("SUPABASE_DB_URL", DB_URL);

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
await c.query("begin");
// Dry run: prove a migration INSIDE the transaction that gets rolled back, so the
// guard can be tested before it is anywhere near the shop's database.
//   VERIFY_APPLY=supabase/migrations/<file>.sql node scripts/_verify-revise-a-billed-quote.mjs
if (process.env.VERIFY_APPLY) {
  const { readFileSync } = await import("node:fs");
  await c.query(readFileSync(process.env.VERIFY_APPLY, "utf8"));
  console.log(`(applied ${process.env.VERIFY_APPLY} for this transaction only)`);
}

const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };

/** Run something that must throw, without poisoning the transaction. */
let probe = 0;
async function refusal(sql, params) {
  const sp = `probe${++probe}`;
  await c.query(`savepoint ${sp}`);
  try {
    await c.query(sql, params);
    await c.query(`release savepoint ${sp}`);
    return null;
  } catch (e) {
    await c.query(`rollback to savepoint ${sp}`);
    return e.message;
  }
}

try {
  await c.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: OWNER, role: "authenticated" }),
  ]);

  const { rows: [ref] } = await c.query(
    `select c.id as customer_id, v.id as vehicle_id,
            -- is_stocked, deliberately: issue_document only moves stock for those, and
            -- the double deduction is half of what this guard exists to prevent.
            (select id from products where is_active and is_stocked and selling_price > 0 order by name limit 1) as p
       from customers c join vehicles v on v.customer_id = c.id limit 1`,
  );

  const quote = async (price) => {
    const { rows: [q] } = await c.query(
      `select (save_draft(
         jsonb_build_object('doc_type','quote','customer_id',$1::text,'vehicle_id',$2::text),
         jsonb_build_array(jsonb_build_object(
           'product_id',$3::text,'title','Two wiper blades','qty',2,'unit_price',$4::numeric,
           'discount_pct',0,'vat_rate',15,'sort_order',0)))).id as id`,
      [ref.customer_id, ref.vehicle_id, ref.p, price],
    );
    return q.id;
  };

  // ── 1. the counter sale: accept a goods-only quote, which bills and issues it ──
  const q1 = await quote(600);
  await c.query("select accept_quote($1, null)", [q1]);
  const { rows: [inv1] } = await c.query("select (convert_quote_to_invoice($1)).id as id", [q1]);
  await c.query("select public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => null)", [inv1.id, `v:${inv1.id}`]);

  const { rows: [bill1] } = await c.query(
    "select number, status, job_id, amount_paid from documents where id = $1", [inv1.id],
  );
  ok(bill1.status === "issued", `the counter bill is ${bill1.status}, not issued — the scenario did not reproduce`);
  ok(bill1.job_id === null, "the counter bill picked up a job — this test needs the job-less shape that broke");

  const { rows: [moved] } = await c.query(
    "select coalesce(sum(qty),0)::numeric as q from stock_movements where ref_type='invoice' and ref_id=$1", [inv1.id],
  );
  ok(Number(moved.q) === -2, `the sale took ${moved.q} off the shelf, expected -2 — the double-deduction risk is what this guards`);

  // ── the hole itself: revising must now refuse, and say what to do ─────────
  const revised = await refusal("select revise_quote($1)", [q1]);
  ok(revised !== null, "a quote with a live, job-less bill was revised — the bill is left behind again");
  ok(
    revised !== null && /already been billed/i.test(revised),
    `the refusal does not explain itself: ${revised}`,
  );
  ok(
    revised !== null && revised.includes(bill1.number),
    `the refusal does not name the bill that is in the way (${bill1.number}): ${revised}`,
  );
  ok(
    revised !== null && /void it/i.test(revised),
    `an UNPAID bill should be voided; the message says something else: ${revised}`,
  );

  // ── 2. a DRAFT bill blocks nothing — seven of eight real revisions sit over one ──
  const q2 = await quote(500);
  await c.query("select convert_quote_to_invoice($1)", [q2]); // draft bill, never issued
  const draftBlocked = await refusal("select revise_quote($1)", [q2]);
  ok(draftBlocked === null, `a DRAFT bill refused a revision — that is the everyday case: ${draftBlocked}`);

  // ── 3. the revision cannot be billed over the standing bill ───────────────
  // Built the only way the shape can still arise: the revision is made BEFORE the
  // parent is billed, so nothing refuses it on the way in.
  const q3 = await quote(600);
  const { rows: [rev3] } = await c.query("select (revise_quote($1)).id as id", [q3]);
  const { rows: [inv3] } = await c.query("select (convert_quote_to_invoice($1)).id as id", [q3]);
  await c.query("select public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => null)", [inv3.id, `v:${inv3.id}`]);
  const { rows: [bill3] } = await c.query("select number from documents where id = $1", [inv3.id]);

  const rebilled = await refusal("select convert_quote_to_invoice($1)", [rev3.id]);
  ok(rebilled !== null, "the revision was billed a second time over a bill still standing");
  ok(
    rebilled !== null && rebilled.includes(bill3.number),
    `the re-billing refusal does not name the standing bill (${bill3.number}): ${rebilled}`,
  );

  // ── 4. a draft raised EARLIER still cannot be issued over it ──────────────
  // This is the shop's live shape: the Rs 1,650 draft already sits on the job, and
  // issuing it would take the same goods off the shelf a second time. The guard has
  // to be on the transition, not only on the two RPCs that raise a bill.
  // The RPCs can no longer BUILD this shape — billing the parent over the
  // revision's draft hands that draft back instead of minting a rival
  // (20260910000010, the line keeps one bill) — so the legacy rows are written
  // the way the live data actually looks, and the guard is proven on the shape
  // it must still catch.
  const q4 = await quote(600);
  const { rows: [rev4] } = await c.query("select (revise_quote($1)).id as id", [q4]);
  const { rows: [inv4b] } = await c.query("select (convert_quote_to_invoice($1)).id as id", [rev4.id]);
  const { rows: [inv4a] } = await c.query(
    `insert into documents (tenant_id, doc_type, status, customer_id, vehicle_id, source_document_id, created_by)
     select tenant_id, 'invoice', 'draft', customer_id, vehicle_id, $2, null
       from documents where id = $1 returning id`, [q4, q4]);
  await c.query(
    `insert into document_lines (tenant_id, document_id, product_id, title, qty, unit_price, discount_pct, vat_rate, sort_order, line_kind, price_includes_vat)
     select tenant_id, $2, product_id, title, qty, unit_price, discount_pct, vat_rate, sort_order, line_kind, price_includes_vat
       from document_lines where document_id = $1`, [q4, inv4a.id]);
  await c.query("select public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => null)", [inv4a.id, `v:${inv4a.id}`]);
  const { rows: [bill4a] } = await c.query("select number from documents where id = $1", [inv4a.id]);

  const issued = await refusal(
    "select public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => null)", [inv4b.id, `v:${inv4b.id}`],
  );
  ok(issued !== null, "the draft bill issued over a bill still standing — the same goods leave the shelf twice");
  ok(
    issued !== null && issued.includes(bill4a.number),
    `the issue refusal does not name the standing bill (${bill4a.number}): ${issued}`,
  );

  const { rows: [dbl] } = await c.query(
    "select coalesce(sum(qty),0)::numeric as q from stock_movements where ref_type='invoice' and ref_id=$1", [inv4b.id],
  );
  ok(Number(dbl.q) === 0, `the refused issue still moved ${dbl.q} of stock`);

  // ── 5. the screens can see what is in the way ─────────────────────────────
  const { rows: seen } = await c.query("select * from superseded_bills($1)", [rev4.id]);
  ok(seen.length === 1, `the revision shows ${seen.length} standing bill(s), expected 1 — staff would see no trace of it`);
  ok(seen[0]?.number === bill4a.number, `the revision names the wrong standing bill: ${seen[0]?.number}`);

  // A quote with nothing behind it must stay quiet, or the warning is noise.
  const { rows: quiet } = await c.query("select * from superseded_bills($1)", [q2]);
  ok(quiet.length === 0, "a quote with only a draft bill is being warned about");

  // ── 6. and all of it clears the moment the bill is retired ────────────────
  await c.query("select void_document($1, $2)", [inv4a.id, "verify: re-priced"]);
  const cleared = await refusal(
    "select public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => null)", [inv4b.id, `v2:${inv4b.id}`],
  );
  ok(cleared === null, `voiding the old bill did not free the replacement: ${cleared}`);

  await c.query("select void_document($1, $2)", [inv1.id, "verify: re-priced"]);
  const freed = await refusal("select revise_quote($1)", [q1]);
  ok(freed === null, `voiding the counter bill did not make the quote revisable again: ${freed}`);

  console.log(`counter bill    : ${bill1.number} issued, 2 units off the shelf, no job`);
  console.log(`revise refused  : ${revised?.slice(0, 120)}…`);
  console.log(`re-bill refused : ${rebilled !== null}`);
  console.log(`issue refused   : ${issued !== null}, stock moved by the refused issue: ${dbl.q}`);
  console.log(`after the void  : revisable again, replacement issues`);

  if (fail.length) {
    console.log("\n✗ FAILED:\n  - " + fail.join("\n  - "));
    process.exitCode = 1;
  } else {
    console.log("\n✓ A quote billed at the counter cannot be revised, re-billed or double-issued behind its own bill — and voiding that bill frees all three.");
  }
} catch (e) {
  console.error("✗ error:", e.message);
  process.exitCode = 1;
} finally {
  await c.query("rollback");
  await c.end();
  console.log("(rolled back — nothing kept)");
}
