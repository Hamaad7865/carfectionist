// Rolled-back verification for "a draft quotation can be sent".
//
// The send path issues the draft on the way out — no migration, so what has to be proved
// is that the RPC actually ACCEPTS the call the way sendDocument() makes it: as a normal
// operator, with no stock location and NO SESSION, under the key quote-send:<id>. Client
// tests prove nothing about what Postgres allows.
//
// Runs as `authenticated` impersonating the owner, then ROLLS BACK — nothing persists.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner auth uid)

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: AUTH, role: "authenticated" })]);

  const tenant = (await c.query("select app.current_tenant_id() as t")).rows[0].t;
  const customer = (await c.query("select id from public.customers where tenant_id = $1 order by created_at limit 1", [tenant])).rows[0].id;
  // A STOCKED product, so the "no stock moved" check below has something to catch.
  const product = (await c.query(
    "select id, selling_price from public.products where tenant_id = $1 and is_stocked order by created_at limit 1",
    [tenant],
  )).rows[0];

  console.log("▸ a draft quotation, exactly as the builder saves one");
  // Through save_draft, not a raw insert: `authenticated` has no INSERT on documents —
  // the app only ever reaches the table through this RPC, so the probe must too.
  const draftDoc = {
    id: null, doc_type: "quote", customer_id: customer, vehicle_id: null,
    template_id: null, template_overrides: {}, valid_until: null, due_date: null,
    origin: "standalone", discount_kind: null, discount_value: 0,
  };
  const draftLines = [{
    product_id: product.id, title: "Ceramic coating", description: null, qty: 1,
    unit_price: Number(product.selling_price), discount_pct: 0, discount_kind: "percent",
    discount_amount: 0, vat_rate: 15, sort_order: 0,
  }];
  const q = (await c.query("select * from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify(draftDoc), JSON.stringify(draftLines),
  ])).rows[0];
  check("starts with no number", q.number, "null");
  check("starts as a draft", q.status, "draft");

  console.log("▸ the send issues it — no stock location, NO SESSION, quote-send key");
  const issued = (await c.query("select * from public.issue_document($1::uuid, null, $2, null)", [q.id, `quote-send:${q.id}`])).rows[0];
  check("it gets a number", issued.number != null, "true");
  check("it reads issued", issued.status, "issued");
  check("it is NOT accepted — only a signature does that", issued.status !== "accepted", "true");
  check("it is stamped with the Mauritius issue date", issued.issue_date != null, "true");
  check("no till is stamped on a quotation", issued.cash_session_id, "null");

  console.log("▸ a quotation moves no goods");
  const moved = (await c.query("select count(*)::int as n from public.stock_movements where ref_id = $1", [q.id])).rows[0].n;
  check("no stock movement written", moved, 0);

  console.log("▸ the same send, replayed — a double tap must not burn a second number");
  const again = (await c.query("select * from public.issue_document($1::uuid, null, $2, null)", [q.id, `quote-send:${q.id}`])).rows[0];
  check("replays the same document", again.id, issued.id);
  check("replays the same number", again.number, issued.number);
  const numbers = (await c.query(
    "select count(*)::int as n from public.documents where tenant_id = $1 and doc_type = 'quote' and number = $2",
    [tenant, issued.number],
  )).rows[0].n;
  check("that number belongs to exactly one quote", numbers, 1);

  console.log("▸ accepting it afterwards still works — sending is not agreeing");
  const acc = (await c.query("select * from public.accept_quote($1::uuid, $2::jsonb)", [
    q.id, JSON.stringify({ path: "sig/probe.png", name: "Probe" }),
  ])).rows[0];
  check("a sent quote can still be accepted", acc.status, "accepted");
  check("the signature is what accepted it", acc.accepted_signature != null, "true");
  check("it kept the number the send gave it", acc.number, issued.number);

  console.log("▸ an empty draft is still refused — nothing to quote");
  const empty = (await c.query("select * from public.save_draft($1::jsonb, '[]'::jsonb, null)", [
    JSON.stringify(draftDoc),
  ])).rows[0];
  try {
    await c.query("savepoint sp1");
    await c.query("select public.issue_document($1::uuid, null, $2, null)", [empty.id, `quote-send:${empty.id}`]);
    check("empty quote refused", "allowed", "refused");
  } catch (e) {
    await c.query("rollback to savepoint sp1");
    check("empty quote refused", /no lines/.test(e.message), "true");
  }
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — nothing persisted (rolled back)." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
