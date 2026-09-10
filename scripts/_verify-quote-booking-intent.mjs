// Proves the booking intent and the credited-bill retirement.
//
// Two gaps that met in the shop:
//   1. JOB-a73c was accepted "for later" with a date and a 25% deposit in mind,
//      but accept-for-later saved neither and "Create job" raised a bare job —
//      scheduled, no time, no deposit bill. set_quote_booking now carries that
//      intent on the quote (no numbers, no money), honoured at "Create job".
//   2. JOB-9F23's "+ Invoice" was refused by the double-bill guard even though
//      the standing bill had already been fully credited (TESTCN-0002). A
//      fully-credited invoice now counts as retired, like a void; a partial or
//      voided credit note still leaves the bill standing.
//
// Runs inside a transaction and ROLLS BACK — nothing here survives.
//   node scripts/_verify-quote-booking-intent.mjs
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b";
requireEnv("SUPABASE_DB_URL", DB_URL);

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
await c.query("begin");

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
            (select id from products where is_active and is_stocked and selling_price > 0 order by name limit 1) as p
       from customers c join vehicles v on v.customer_id = c.id limit 1`,
  );

  const quote = async (price) => {
    const { rows: [q] } = await c.query(
      `select (save_draft(
         jsonb_build_object('doc_type','quote','customer_id',$1::text,'vehicle_id',$2::text),
         jsonb_build_array(jsonb_build_object(
           'product_id',$3::text,'title','Verify booking','qty',1,'unit_price',$4::numeric,
           'discount_pct',0,'vat_rate',15,'sort_order',0)))).id as id`,
      [ref.customer_id, ref.vehicle_id, ref.p, price],
    );
    return q.id;
  };

  // ── 1. the intent is stored on accept-for-later ──────────────────────────
  const q1 = await quote(4950);
  await c.query("select accept_quote($1, null)", [q1]);
  await c.query("select set_quote_booking($1, $2, $3)", [q1, "2026-09-20T10:00:00+04:00", 1237.5]);
  const { rows: [b1] } = await c.query(
    "select book_for_at, deposit_due from documents where id = $1", [q1],
  );
  ok(b1.book_for_at !== null, "book_for_at was not stored");
  ok(
    new Date(b1.book_for_at).getTime() === new Date("2026-09-20T10:00:00+04:00").getTime(),
    `book_for_at came back as ${b1.book_for_at}, expected the picked moment`,
  );
  ok(Number(b1.deposit_due) === 1237.5, `deposit_due is ${b1.deposit_due}, expected 1237.50`);
  const { rows: [a1] } = await c.query(
    "select count(*)::int as n from audit_events where ref_id = $1 and event_type = 'quote_booking_set'", [q1],
  );
  ok(a1.n === 1, "no quote_booking_set audit row — the intent left no trail");

  // ── 2. the intent refuses nonsense ───────────────────────────────────────
  const over = await refusal("select set_quote_booking($1, null, $2)", [q1, 99999]);
  ok(over !== null, "a deposit bigger than the quoted total was stored");
  const neg = await refusal("select set_quote_booking($1, null, $2)", [q1, -5]);
  ok(neg !== null, "a negative deposit was stored");
  const q2 = await quote(100);
  const draft = await refusal("select set_quote_booking($1, $2, $3)", [q2, "2026-09-20T10:00:00+04:00", 25]);
  ok(draft !== null, "a DRAFT quote took a booking — nothing is agreed yet");
  const ghost = await refusal("select set_quote_booking($1, null, null)", ["00000000-0000-0000-0000-000000000000"]);
  ok(ghost !== null, "a booking landed on a quote that does not exist");

  // ── 3. a fully-credited bill retires the guard ───────────────────────────
  // Same shape as the shop: bill the parent, revise, then credit the bill.
  const q3 = await quote(600);
  const { rows: [rev3] } = await c.query("select (revise_quote($1)).id as id", [q3]);
  const { rows: [inv3] } = await c.query("select (convert_quote_to_invoice($1)).id as id", [q3]);
  await c.query("select public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => null)", [inv3.id, `v:${inv3.id}`]);
  const blocked = await refusal("select convert_quote_to_invoice($1)", [rev3.id]);
  ok(blocked !== null, "the revision billed over a standing bill — the guard went quiet");
  await c.query("select create_and_issue_credit_note($1, null, false, null)", [inv3.id]);
  const { rows: [seen3] } = await c.query("select count(*)::int as n from superseded_bills($1)", [rev3.id]);
  ok(seen3.n === 0, `the credited bill still stands (${seen3.n}) — JOB-9F23 all over again`);
  const freed = await refusal("select convert_quote_to_invoice($1)", [rev3.id]);
  ok(freed === null, `the credit note did not free the revision: ${freed}`);

  // ── 4. a voided or partial credit note retires nothing ───────────────────
  const q4 = await quote(700);
  const { rows: [rev4] } = await c.query("select (revise_quote($1)).id as id", [q4]);
  const { rows: [inv4] } = await c.query("select (convert_quote_to_invoice($1)).id as id", [q4]);
  await c.query("select public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => null)", [inv4.id, `v:${inv4.id}`]);
  const { rows: [inv4row] } = await c.query(
    "select tenant_id, customer_id, vehicle_id, total_incl from documents where id = $1", [inv4.id],
  );
  // A voided full credit: refunded on paper, then voided — the bill stands.
  await c.query(
    `insert into documents (tenant_id, doc_type, status, number, customer_id, vehicle_id,
       source_document_id, total_incl, created_by)
     values ($1, 'credit_note', 'void', 'VERIFY-CN-VOID', $2, $3, $4, $5, $6)`,
    [inv4row.tenant_id, inv4row.customer_id, inv4row.vehicle_id, inv4.id, inv4row.total_incl, null],
  );
  // A live partial credit: money still owed on the bill.
  await c.query(
    `insert into documents (tenant_id, doc_type, status, number, customer_id, vehicle_id,
       source_document_id, total_incl, created_by)
     values ($1, 'credit_note', 'issued', 'VERIFY-CN-PART', $2, $3, $4, 1.00, $5)`,
    [inv4row.tenant_id, inv4row.customer_id, inv4row.vehicle_id, inv4.id, null],
  );
  const { rows: [seen4] } = await c.query("select count(*)::int as n from superseded_bills($1)", [rev4.id]);
  ok(seen4.n === 1, `void + partial credits retired the bill (${seen4.n} standing) — only a FULL live credit retires`);
  const still = await refusal("select convert_quote_to_invoice($1)", [rev4.id]);
  ok(still !== null, "the revision billed over a partly-credited bill");

  console.log("booking stored      : ok");
  console.log("nonsense refused    : over/total, negative, draft, ghost");
  console.log("full credit retires : ok");
  console.log("void/partial stay   : ok");

  if (fail.length) {
    console.error(`\nFAIL (${fail.length}):`);
    for (const f of fail) console.error(" - " + f);
    await c.query("rollback");
    process.exit(1);
  }
  await c.query("rollback");
  console.log("\nPASS — rolled back, nothing survives.");
} catch (e) {
  try { await c.query("rollback"); } catch { /* already out */ }
  console.error("VERIFY ERROR: " + e.message);
  process.exit(1);
} finally {
  await c.end();
}
