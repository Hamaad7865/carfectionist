// Proves a re-price never carries a reversed payment onto the new bill.
//
// Shape: quote accepted -> job -> bill issued -> cash payment taken, then
// REVERSED (partial refund) -> quote revised -> revision accepted. The old
// bill's live money moves; the dead (reversed) row must not.
// BUGHUNT C1. Runs inside a transaction and ROLLS BACK — nothing survives.
//   node scripts/_verify-reprice-skips-reversed.mjs
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b";
requireEnv("SUPABASE_DB_URL", DB_URL);

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
await c.query("begin");

const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };

try {
  await c.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: OWNER, role: "authenticated" }),
  ]);

  const { rows: [ref] } = await c.query(
    `select c.id as customer_id, v.id as vehicle_id, c.tenant_id,
            (select id from products where is_active and is_stocked and selling_price > 0 order by name limit 1) as p
       from customers c join vehicles v on v.customer_id = c.id limit 1`,
  );

  // Quote -> accept -> job (first accept: no old bill, no re-price).
  const { rows: [q1] } = await c.query(
    `select (save_draft(
       jsonb_build_object('doc_type','quote','customer_id',$1::text,'vehicle_id',$2::text),
       jsonb_build_array(jsonb_build_object(
         'product_id',$3::text,'title','Verify reprice','qty',1,'unit_price',1000::numeric,
         'discount_pct',0,'vat_rate',15,'sort_order',0)))).id as id`,
    [ref.customer_id, ref.vehicle_id, ref.p],
  );
  await c.query("select accept_quote($1, null)", [q1.id]);
  const { rows: [jb] } = await c.query("select (convert_quote_to_job($1::uuid, null, null, null)).id as id", [q1.id]);

  // Revise BEFORE billing (revising a billed quote is refused by design).
  const { rows: [q2] } = await c.query("select (revise_quote($1)).id as id", [q1.id]);

  // Bill the parent, issue, take Rs 1000 cash, then reverse it in full.
  const { rows: [inv1] } = await c.query("select (convert_quote_to_invoice($1)).id as id", [q1.id]);
  await c.query(
    "select public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => null)",
    [inv1.id, `v:${inv1.id}`],
  );
  const { rows: [pay] } = await c.query(
    `insert into payments (tenant_id, document_id, method, amount, tendered, change_given)
     values ($1, $2, 'cash', 1000, 1000, 0) returning id`,
    [ref.tenant_id, inv1.id],
  );
  await c.query(
    `insert into payments (tenant_id, document_id, method, amount, reverses_payment_id)
     values ($1, $2, 'cash', -1000, $3)`,
    [ref.tenant_id, inv1.id, pay.id],
  );

  // Accept the revision: re-price branch voids the old bill and rebills.
  const { rows: [jb2] } = await c.query("select (convert_quote_to_job($1::uuid, null, null, null)).id as id", [q2.id]);
  ok(jb2.id === jb.id, `re-price opened a second job ${jb2.id} instead of reusing ${jb.id}`);

  // The new bill must carry NOTHING: the only payment was reversed.
  const { rows: carried } = await c.query(
    `select d.id, d.number, d.status,
            (select count(*)::int from payments p where p.document_id = d.id and p.amount > 0) as legs,
            (select coalesce(sum(amount),0)::numeric from payments p where p.document_id = d.id) as net
       from documents d
      where d.doc_type = 'invoice' and d.source_document_id = $1 and d.status <> 'void'
      order by d.created_at desc limit 1`,
    [q2.id],
  );
  ok(carried.length === 1, `expected one live rebill, found ${carried.length}`);
  if (carried.length === 1) {
    ok(carried[0].legs === 0, `the reversed Rs 1000 was carried onto ${carried[0].number} (${carried[0].legs} legs)`);
    ok(Number(carried[0].net) === 0, `rebill net is ${carried[0].net}, expected 0`);
  }
  // And the old bill is voided, not standing beside it.
  const { rows: [old] } = await c.query("select status from documents where id = $1", [inv1.id]);
  ok(old.status === "void", `old bill is ${old.status}, not void`);

  console.log("re-price skips reversed payments : ok");

  if (fail.length) {
    console.error(`\nFAIL (${fail.length}):`);
    for (const f of fail) console.error(" - " + f);
    await c.query("rollback");
    process.exit(1);
  }
  await c.query("rollback");
  console.log("PASS — rolled back, nothing survives.");
} catch (e) {
  try { await c.query("rollback"); } catch { /* already out */ }
  console.error("VERIFY ERROR: " + e.message);
  process.exit(1);
} finally {
  await c.end();
}
