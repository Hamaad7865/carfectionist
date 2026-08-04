// Regression test for 20260804000010 (billing a quote accepts it) against the LIVE DB —
// one rolled-back transaction, nothing persists.
//
//   node scripts/_verify-billed-quote-accepted.mjs
//
// The tablet bills a walk-in quote straight out of draft. convert_quote_to_invoice only
// flipped an 'issued' quote to 'accepted', so the draft stayed a draft — a finished sale
// still sitting in the drafts list, opening in the BUILDER (drafts never reach the detail
// page), with "Delete draft" as its only lever. That delete then failed on
// documents_source_document_id_fkey, because the paid invoice points back at it, and the
// invoice is fiscally locked so the link cannot be cut. Undeletable by every route.
// Found on the quote behind INV-0063 (2026-08-03).
import pg from "pg";
import { randomUUID } from "node:crypto";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const OWNER_AUTH_UID = "0eb870dc-ef5b-400a-8744-859c999a1b1b";

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
let ok = true;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) ok = false;
};
const expectError = async (name, sql, params, needle) => {
  await c.query("savepoint exp");
  try { await c.query(sql, params); check(name, false, "no error raised"); }
  catch (e) { check(name, e.message.includes(needle), e.message.slice(0, 110)); }
  await c.query("rollback to savepoint exp");
};
const doc = async (id) =>
  (await c.query(`select status::text, number, source_document_id from public.documents where id=$1`, [id])).rows[0];

// What "Bill now" builds first: a saved draft quote, never issued, never sent.
async function draftQuote(pair, tag) {
  const qid = randomUUID();
  await c.query(`select public.save_draft($1::jsonb,$2::jsonb,null)`, [
    JSON.stringify({ id: qid, doc_type: "quote", customer_id: pair.customer_id, vehicle_id: pair.vehicle_id, origin: "standalone" }),
    JSON.stringify([{
      product_id: null, title: `Billed-draft dry-run ${tag}`, qty: 1, unit_price: 500,
      discount_pct: 0, vat_rate: 15, sort_order: 0,
      // Carried so the assertion below can prove the line copy did not drop it. This
      // function names its columns explicitly, and a stale list here silently strips
      // every description from every bill without erroring.
      description: "- Ceramic Coating 3 years protection on body only",
      description_richtext: { schemaVersion: 1, blocks: [{ type: "ul", items: [[{ text: "Ceramic Coating 3 years protection on body only" }]] }] },
      unit_label: "panels",
    }]),
  ]);
  return qid;
}

try {
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: OWNER_AUTH_UID, role: "authenticated" })]);
  const tenant = (await c.query(`select app.current_tenant_id() t`)).rows[0].t;
  await c.query(`update public.trading_days set status='open' where tenant_id=$1 and business_date=app.mu_today() and status='closed'`, [tenant]);
  const pair = (await c.query(`
    select customer_id, vehicle_id from public.documents
     where doc_type='quote' and customer_id is not null and vehicle_id is not null limit 1`)).rows[0];
  if (!pair) { console.log("⚠ no quote with customer+vehicle to borrow a pair from"); process.exit(1); }

  const nextQuoteNumber = async () =>
    (await c.query(`select quote_next_number n from public.business_settings where id=$1`, [tenant])).rows[0].n;
  const prefix = (await c.query(`select quote_prefix p from public.business_settings where id=$1`, [tenant])).rows[0].p;

  // ── the counter sale ────────────────────────────────────────────────────────
  console.log("— billing a walk-in quote out of draft —");
  const seriesBefore = await nextQuoteNumber();
  const qid = await draftQuote(pair, "counter");
  check("it starts life as a draft, as the tablet saves it", (await doc(qid)).status === "draft");
  const inv = (await c.query(`select id from public.convert_quote_to_invoice($1)`, [qid])).rows[0];
  await c.query(`select public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => null)`,
    [inv.id, `bqa:counter:issue`]);

  const q = await doc(qid);
  check("raising the bill accepts the quote — it leaves the drafts list", q.status === "accepted", q.status);
  check("it takes a quote number on the way out (documents_check refuses a numberless non-draft)",
    q.number !== null && q.number.startsWith(prefix), q.number ?? "null");
  check("the number comes off the quote series, gaplessly",
    (await nextQuoteNumber()) === seriesBefore + 1, `${seriesBefore} → ${await nextQuoteNumber()}`);
  check("the bill still points back at what was quoted", (await doc(inv.id)).source_document_id === qid);

  // 20260804000030 taught the four line-copy functions to carry rich content. This one
  // is redefined here too, so it has to keep carrying it — the failure is silent, and
  // shows up as a customer's invoice missing the bullets that justified the price.
  const billed = (await c.query(
    `select jsonb_typeof(description_richtext) rt, unit_label, description
       from public.document_lines where document_id=$1 order by sort_order limit 1`, [inv.id])).rows[0];
  check("the bill keeps the line's rich description", billed.rt === "object", billed.rt);
  check("the bill keeps the line's unit", billed.unit_label === "panels", billed.unit_label);
  check("the bill keeps the flat mirror too", (billed.description ?? "").includes("Ceramic Coating"), billed.description);
  check("the detail page can now open it (drafts redirect to the builder)", (await doc(qid)).status !== "draft");

  // Same call again: the tablet retries this on a flaky connection.
  const again = (await c.query(`select id from public.convert_quote_to_invoice($1)`, [qid])).rows[0];
  check("billing twice still hands back the same invoice", again.id === inv.id);

  // The FK is not the bug and stays exactly as strict — a bill's lineage is part of
  // its record. What changed is that no route in the app offers to delete this now.
  await expectError("deleting the billed quote is still refused by the FK",
    `delete from public.documents where id=$1`, [qid], "documents_source_document_id_fkey");

  // ── no regression on the path that already worked ───────────────────────────
  console.log("\n— a quote that was sent first still behaves as before —");
  const sent = await draftQuote(pair, "sent");
  await c.query(`select public.issue_document(p_document_id => $1, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => null)`,
    [sent, `bqa:sent:issue`]);
  check("issuing a quote numbers it", (await doc(sent)).number !== null);
  const sentInv = (await c.query(`select id from public.convert_quote_to_invoice($1)`, [sent])).rows[0];
  check("billing it flips issued → accepted, number intact",
    (await doc(sent)).status === "accepted" && (await doc(sent)).number !== null);
  check("  and it is a real invoice", (await doc(sentInv.id)).source_document_id === sent);

  // ── a dead quote is still not billable ──────────────────────────────────────
  const dead = await draftQuote(pair, "dead");
  // numbered by hand, off-series: documents_check refuses a numberless non-draft
  await c.query(`update public.documents set number='DRYRUN-DECLINED', status='declined' where id=$1`, [dead]);
  await expectError("a declined quote still cannot be billed",
    `select public.convert_quote_to_invoice($1)`, [dead], "cannot invoice a declined quote");

  // ── the live data, outside this transaction's own writes ────────────────────
  console.log("\n— what the backfill left —");
  const stranded = (await c.query(`
    select count(*)::int n from public.documents q
     where q.doc_type='quote' and q.status='draft' and q.id <> all($1::uuid[])
       and exists (select 1 from public.documents i
                    where i.source_document_id=q.id and i.doc_type='invoice' and i.status <> 'void')`,
    [[qid, sent, dead]])).rows[0].n;
  check("no draft quote is stranded behind a live bill any more", stranded === 0, `${stranded} left`);
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(ok ? "\n✓ all checks passed (rolled back — nothing persisted)" : "\n✗ FAILURES above (rolled back)");
process.exit(ok ? 0 : 1);
