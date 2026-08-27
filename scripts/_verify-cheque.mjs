// Cheque payment method — DB probe. Always ROLLS BACK.
//   node scripts/_verify-cheque.mjs
// Runs in the SANDBOX tenant (no trading day today, so issue_document works).
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const SANDBOX_AUTH = "b729191b-1159-4d46-88c7-3c9aceb5e664"; // TEST Sandbox (owner)

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};
const asRefusal = (out, want, token) => (out.includes(want) ? token : out);
const mkLine = (over) => ({
  product_id: null, title: "Cheque probe line", description: null, qty: 1, unit_price: 1000,
  discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15,
  sort_order: 0, line_kind: "product", ...over,
});

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
const asUser = async (authUid) => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: authUid, role: "authenticated" }),
  ]);
};

try {
  await c.query("begin");
  await asUser(SANDBOX_AUTH);
  const tenant = (await c.query("select app.current_tenant_id() as t")).rows[0].t;

  console.log("▸ 0. 'cheque' is a payment_method value");
  const enumHasCheque = (await c.query(
    "select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='payment_method' and e.enumlabel='cheque'",
  )).rowCount;
  check("enum contains cheque", enumHasCheque, 1);

  const cust = (await c.query(
    "insert into public.customers (tenant_id, name) values ($1,'Cheque Probe Customer') returning id",
    [tenant],
  )).rows[0].id;

  // A fresh session dated TODAY — a reused sandbox session is often stale, and the
  // stale-till guard blocks record_payment on it.
  const till = (await c.query(
    "select id, status from public.open_cash_session($1, 0)", [`SANDBOX-CHEQUE-${Date.now()}`],
  )).rows[0];
  check("a till is open for the sandbox", till.status, "open");

  console.log("▸ 1. a cheque payment with NO reference is accepted");
  const draft = (await c.query(
    "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: cust }), JSON.stringify([mkLine({})])],
  )).rows[0];
  const inv = (await c.query("select * from public.issue_document($1::uuid, null, null, null)", [draft.id])).rows[0];
  check("invoice total_incl", inv.total_incl, "1150.00");

  const pay = (await c.query(
    "select id, method, amount, external_ref, tendered, change_given from public.record_payment($1::uuid, 'cheque'::payment_method, 1150, null, null, $2::uuid, null, null)",
    [inv.id, till.id],
  )).rows[0];
  check("payment method", pay.method, "cheque");
  check("external_ref is null", pay.external_ref, null);
  check("tendered is null (no drawer)", pay.tendered, null);
  check("change_given is null", pay.change_given, null);
  const invStatus = (await c.query("select status from public.documents where id=$1", [inv.id])).rows[0].status;
  check("the invoice is fully paid", invStatus, "paid");

  console.log("▸ 2. a cheque payment WITH a reference keeps it");
  const d2 = (await c.query(
    "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: cust }), JSON.stringify([mkLine({})])],
  )).rows[0];
  const inv2 = (await c.query("select * from public.issue_document($1::uuid, null, null, null)", [d2.id])).rows[0];
  const pay2 = (await c.query(
    "select external_ref from public.record_payment($1::uuid, 'cheque'::payment_method, 1150, null, 'CHQ-778812', $2::uuid, null, null)",
    [inv2.id, till.id],
  )).rows[0];
  check("typed cheque number is stored", pay2.external_ref, "CHQ-778812");

  console.log("▸ 3. card / Juice / bank still REQUIRE a reference");
  const d3 = (await c.query(
    "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: cust }), JSON.stringify([mkLine({})])],
  )).rows[0];
  const inv3 = (await c.query("select * from public.issue_document($1::uuid, null, null, null)", [d3.id])).rows[0];
  let cardOutcome = "accepted";
  await c.query("savepoint s3");
  try {
    await c.query(
      "select from public.record_payment($1::uuid, 'card'::payment_method, 1150, null, null, $2::uuid, null, null)",
      [inv3.id, till.id],
    );
  } catch (e) { cardOutcome = e.message; }
  await c.query("rollback to savepoint s3");
  check(
    "a card payment with no ref is refused",
    asRefusal(cardOutcome, "requires an external reference", "refused: needs a reference"),
    "refused: needs a reference",
  );

  console.log("▸ 4. the cheque shows on the cash-up, and NOT in expected_cash");
  const summary = (await c.query("select public.pre_close_summary($1::uuid) s", [till.id])).rows[0].s;
  const methods = summary.methods.map((m) => m.method);
  check("pre_close_summary lists a cheque row", methods.includes("cheque"), true);
  const chequeRow = summary.methods.find((m) => m.method === "cheque");
  check("cheque takings on the cash-up", chequeRow?.takings, 2300); // the two cheque sales above
  // expected_cash = float only (0) — no cash taken, cheques excluded
  check("expected_cash unaffected by cheques", Number(summary.expected_cash), 0);

  console.log("▸ 5. a cheque payment can be reversed");
  const rev = (await c.query(
    "select method, amount from public.reverse_payment($1::uuid, 'cheque probe: bounced', $2::uuid)",
    [pay.id, till.id],
  )).rows[0];
  check("reversal method is cheque", rev.method, "cheque");
  check("reversal amount is negative", Number(rev.amount) < 0, true);
  const invStatusAfter = (await c.query("select status from public.documents where id=$1", [inv.id])).rows[0].status;
  check("the invoice re-opens after the reversal", ["issued", "partly_paid"].includes(invStatusAfter), true);

  await c.query("rollback");
  console.log(`\n${failures === 0 ? "✓ ALL PASSED" : `✗ ${failures} FAILURE(S)`}`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (err) {
  await c.query("rollback").catch(() => {});
  console.error("✗ probe threw:", err.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
