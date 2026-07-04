// Phase 1 money-path verification: runs the full DoD chain through the RPCs
// as the owner, then ROLLS BACK so the real number series is untouched.
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);

const OWNER = "a0000000-0000-4000-a000-000000000001";
const CUSTOMER = "0c000000-0000-4000-8000-000000000001";
const P = {
  decon: "0e000000-0000-4000-8000-000000000001",
  wheel: "0e000000-0000-4000-8000-000000000002",
  db3yr: "0e000000-0000-4000-8000-000000000003",
};

const lines = [
  { product_id: P.decon, title: "Full Decontamination & Body Polish", qty: 1, unit_price: 32000, vat_rate: 15 },
  { product_id: P.wheel, title: "Remove Wheel, Decontamination & Polish", qty: 4, unit_price: 3800, vat_rate: 15 },
  { product_id: P.db3yr, title: "Diamondbrite 3-Year Protection (Exterior Only)", qty: 1, unit_price: 30000, vat_rate: 15 },
];

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (expected ${want})`}`);
};

const client = new pg.Client({ connectionString: DB_URL });
try {
  await client.connect();
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: OWNER, role: "authenticated" }),
  ]);

  console.log("▸ save_draft (Diamondbrite quote)");
  const draft = await client.query(
    "select id, subtotal_excl, vat_total, total_incl from public.save_draft($1::jsonb, $2::jsonb, null)",
    [JSON.stringify({ doc_type: "quote", customer_id: CUSTOMER }), JSON.stringify(lines)],
  );
  const q = draft.rows[0];
  check("subtotal_excl", q.subtotal_excl, "77200.00");
  check("vat_total", q.vat_total, "11580.00");
  check("total_incl", q.total_incl, "88780.00");

  console.log("▸ issue_document (quote)");
  const issuedQuote = await client.query("select number, status from public.issue_document($1::uuid, null, null)", [q.id]);
  check("quote number", issuedQuote.rows[0].number, "A00116");
  check("quote status", issuedQuote.rows[0].status, "issued");

  console.log("▸ convert_quote_to_invoice");
  const conv = await client.query("select id, doc_type, status, source_document_id from public.convert_quote_to_invoice($1::uuid)", [q.id]);
  const inv = conv.rows[0];
  check("invoice doc_type", inv.doc_type, "invoice");
  check("invoice carries source", inv.source_document_id, q.id);
  check("invoice total copied", (await client.query("select total_incl from documents where id=$1", [inv.id])).rows[0].total_incl, "88780.00");

  console.log("▸ issue_document (invoice)");
  const issuedInv = await client.query("select number, status from public.issue_document($1::uuid, null, null)", [inv.id]);
  check("invoice number", issuedInv.rows[0].number, "INV-0001");

  console.log("▸ record_payment (card 50,000)");
  await client.query(
    "select method, amount from public.record_payment($1::uuid, 'card'::payment_method, 50000, null, 'CARD-TERMINAL-8842', null, null, null)",
    [inv.id],
  );
  const afterFirst = await client.query("select status, amount_paid from documents where id=$1", [inv.id]);
  check("status after 1st payment", afterFirst.rows[0].status, "partly_paid");

  console.log("▸ record_payment (cash 38,780, tendered 40,000)");
  const cash = await client.query(
    "select change_given from public.record_payment($1::uuid, 'cash'::payment_method, 38780, 40000, null, null, null, null)",
    [inv.id],
  );
  check("cash change_given", cash.rows[0].change_given, "1220.00");
  const paid = await client.query("select status, amount_paid, total_incl from documents where id=$1", [inv.id]);
  check("final status", paid.rows[0].status, "paid");
  check("amount_paid == total", paid.rows[0].amount_paid, paid.rows[0].total_incl);

  console.log("▸ fiscal lock: editing the issued invoice's lines must be rejected");
  try {
    await client.query("update document_lines set unit_price = 1 where document_id = $1", [inv.id]);
    check("line edit rejected", "allowed", "rejected");
  } catch {
    check("line edit rejected", "rejected", "rejected");
  }

  await client.query("rollback");
  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`} (rolled back — series untouched)`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (err) {
  try { await client.query("rollback"); } catch {}
  console.error("✗ verify error:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
