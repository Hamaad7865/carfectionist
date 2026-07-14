// Proves the revision lifecycle: quote → job → revise → accept → bill.
// The revision must re-price the SAME job (not open a second card), the bill must
// follow the price the customer signed LAST, and a job already invoiced must refuse
// to be re-priced behind the customer's back.
// Runs inside a transaction and ROLLS BACK — nothing here survives.
//   node scripts/_verify-revision.mjs
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
    `select c.id as customer_id, v.id as vehicle_id,
            (select id from products where is_active and selling_price > 0 order by name limit 1) as p
       from customers c join vehicles v on v.customer_id = c.id limit 1`,
  );

  const quote = async (price) => {
    const { rows: [q] } = await c.query(
      `select (save_draft(
         jsonb_build_object('doc_type','quote','customer_id',$1::text,'vehicle_id',$2::text),
         jsonb_build_array(jsonb_build_object(
           'product_id',$3::text,'title','The work','qty',1,'unit_price',$4::numeric,
           'discount_pct',0,'vat_rate',15,'sort_order',0)))).id as id`,
      [ref.customer_id, ref.vehicle_id, ref.p, price],
    );
    return q.id;
  };

  // ── 1. original quote at Rs 1000, accepted → a job ────────────────────────
  const q1 = await quote(1000);
  await c.query("select issue_document(p_document_id => $1, p_idempotency_key => $2)", [q1, `v:${q1}`]);
  const { rows: [j1] } = await c.query("select (convert_quote_to_job($1, null, null)).id as id", [q1]);

  const { rows: [jobsAfterAccept] } = await c.query(
    "select count(*)::int as n from jobs where vehicle_id = $1", [ref.vehicle_id],
  );

  // ── 2. the customer haggles: revise to Rs 800, accept the revision ─────────
  const { rows: [rev] } = await c.query("select (revise_quote($1)).id as id", [q1]);
  await c.query(
    `select save_draft(
       jsonb_build_object('id',$1::text,'doc_type','quote','customer_id',$2::text,'vehicle_id',$3::text),
       jsonb_build_array(jsonb_build_object(
         'product_id',$4::text,'title','The work','qty',1,'unit_price',800,
         'discount_pct',0,'vat_rate',15,'sort_order',0)))`,
    [rev.id, ref.customer_id, ref.vehicle_id, ref.p],
  );
  const { rows: [j2] } = await c.query("select (convert_quote_to_job($1, null, null)).id as id", [rev.id]);

  ok(j2.id === j1.id, `accepting the revision opened a SECOND job (${j1.id} → ${j2.id})`);

  const { rows: [jobsAfterRevise] } = await c.query(
    "select count(*)::int as n from jobs where vehicle_id = $1", [ref.vehicle_id],
  );
  ok(
    jobsAfterRevise.n === jobsAfterAccept.n,
    `the board grew a duplicate card: ${jobsAfterAccept.n} job(s) → ${jobsAfterRevise.n}`,
  );

  // The job keeps the quote it was born from — jobs_guard makes that lineage immutable,
  // and it is a fact about history, not a field to overwrite. What moves is the BILL.
  const { rows: [job] } = await c.query("select source_quote_id from jobs where id = $1", [j1.id]);
  ok(job.source_quote_id === q1, "the job's lineage was rewritten — it must still name the quote it was born from");

  const { rows: [revDoc] } = await c.query("select status, job_id from documents where id = $1", [rev.id]);
  ok(revDoc.status === "accepted", `the revision was not accepted (status ${revDoc.status})`);
  ok(revDoc.job_id === j1.id, "the accepted revision is not attached to the job");

  const { rows: [orig] } = await c.query("select status, total_incl from documents where id = $1", [q1]);
  ok(Number(orig.total_incl) === 1150, `the original quote was rewritten (total is now ${orig.total_incl}, was 1150 incl VAT)`);

  // ── 3. the bill must follow the price signed LAST ─────────────────────────
  const { rows: [inv] } = await c.query("select (create_document_from_job($1,'invoice')).id as id", [j1.id]);
  const { rows: [bill] } = await c.query("select total_incl, source_document_id from documents where id = $1", [inv.id]);
  ok(Number(bill.total_incl) === 920, `the bill is Rs ${bill.total_incl} — it should be Rs 920 (the revised 800 + VAT)`);
  ok(bill.source_document_id === rev.id, "the invoice does not point at the revision it was priced from");

  // ── 3b. THE TABLET'S PATH — the one the audit caught billing the old price ──
  // JobsViewModel hands convert_quote_to_invoice the job's source_quote_id, which is the
  // immutable ORIGINAL. Whatever quote it is given, the answer must be the signed price.
  const { rows: [viaOriginal] } = await c.query(
    "select (convert_quote_to_invoice($1)).total_incl as total", [q1],
  );
  ok(
    Number(viaOriginal.total) === 920,
    `billing via the ORIGINAL quote id (what the tablet does) charged Rs ${viaOriginal.total} — it must be Rs 920, the price signed last`,
  );

  // ── 4. an invoiced job refuses to be re-priced behind the customer's back ──
  await c.query("select issue_document(p_document_id => $1, p_idempotency_key => $2)", [inv.id, `v:${inv.id}`]);
  const rev2 = (await c.query("select (revise_quote($1)).id as id", [rev.id])).rows[0].id;
  // A raised exception aborts the whole transaction unless it is fenced off.
  let refused = false;
  await c.query("savepoint probe1");
  try {
    await c.query("select convert_quote_to_job($1, null, null)", [rev2]);
  } catch (e) {
    refused = /already been invoiced/i.test(e.message);
  }
  await c.query("rollback to savepoint probe1");
  ok(refused, "a job that has already been invoiced allowed itself to be silently re-priced");

  // ── 5. revising the same quote twice must not fork two rival prices ────────
  let forkRefused = false;
  await c.query("savepoint probe2");
  try {
    await c.query("select revise_quote($1)", [q1]); // q1 already has `rev`
  } catch (e) {
    forkRefused = /already been revised/i.test(e.message);
  }
  await c.query("rollback to savepoint probe2");
  ok(forkRefused, "the same quote could be revised twice, forking two rival prices for one car");

  // ── 6. a cancelled job must not swallow a freshly signed revision ──────────
  const qc = await quote(1000);
  await c.query("select issue_document(p_document_id => $1, p_idempotency_key => $2)", [qc, `v:${qc}`]);
  const { rows: [jc] } = await c.query("select (convert_quote_to_job($1, null, null)).id as id", [qc]);
  await c.query("update jobs set status = 'cancelled' where id = $1", [jc.id]);
  const revC = (await c.query("select (revise_quote($1)).id as id", [qc])).rows[0].id;
  const { rows: [jc2] } = await c.query("select (convert_quote_to_job($1, null, null)).id as id", [revC]);
  ok(jc2.id !== jc.id, "a signed revision was attached to a CANCELLED job — the work vanishes from the board");
  const { rows: [jc2row] } = await c.query("select status from jobs where id = $1", [jc2.id]);
  ok(jc2row.status === "scheduled", `the revision's new job is ${jc2row.status}, not scheduled`);

  console.log(`original quote : Rs ${orig.total_incl} incl (status ${orig.status}) — untouched`);
  console.log(`job            : ${j1.id === j2.id ? "same job re-priced" : "DUPLICATED"}, now billing from the revision`);
  console.log(`invoice        : Rs ${bill.total_incl} incl`);
  console.log(`invoiced job re-price refused: ${refused}`);

  if (fail.length) {
    console.log("\n✗ FAILED:\n  - " + fail.join("\n  - "));
    process.exitCode = 1;
  } else {
    console.log("\n✓ A revision re-prices the same car: one job, billed at the price signed last, the original kept as the record — and a job already invoiced refuses to be re-priced.");
  }
} catch (e) {
  console.error("✗ error:", e.message);
  process.exitCode = 1;
} finally {
  await c.query("rollback");
  await c.end();
  console.log("(rolled back — nothing kept)");
}
