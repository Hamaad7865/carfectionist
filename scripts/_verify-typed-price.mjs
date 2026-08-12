// Rolled-back verification for "the typed price is the price" (20260812000020).
//
// A line flagged price_includes_vat stores the GROSS exactly as typed and the
// ledger extracts the VAT — so 1000 stays 1000.00, discounts land flat, and the
// excl+vat pair always sums to the typed figure. Unflagged lines must behave
// byte-for-byte as before (net + VAT on top).
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const TENANT = "22222222-2222-4222-8222-000000000002";
const OWNER_AUTH = "b729191b-1159-4d46-88c7-3c9aceb5e664";

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
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" }),
  ]);
  const customer = (await c.query(
    "select id from public.customers where tenant_id=$1 order by created_at limit 1", [TENANT],
  )).rows[0].id;

  const draft = async (lines) => (await c.query("select * from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ id: null, doc_type: "invoice", customer_id: customer, vehicle_id: null,
      template_id: null, template_overrides: {}, valid_until: null, due_date: null,
      origin: "standalone", discount_kind: null, discount_value: 0 }),
    JSON.stringify(lines),
  ])).rows[0];
  const linesOf = async (docId) => (await c.query(
    "select title, unit_price, price_includes_vat, line_total_excl, line_vat, (line_total_excl + line_vat) as incl from public.document_lines where document_id=$1 order by sort_order", [docId],
  )).rows;

  console.log("▸ a flagged Rs 1000 line lands on exactly 1000.00");
  const d1 = await draft([{ product_id: null, title: "adhoc labour", qty: 1, unit_price: 1000,
    discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15, sort_order: 0,
    line_kind: "service", price_includes_vat: true }]);
  const [l1] = await linesOf(d1.id);
  check("excl", l1.line_total_excl, "869.57");
  check("vat (extracted)", l1.line_vat, "130.43");
  check("incl — the typed figure", l1.incl, "1000.00");
  check("document total", d1.total_incl, "1000.00");

  console.log("▸ qty and discounts stay exact on a flagged line");
  const d2 = await draft([
    { product_id: null, title: "two at 1000, 10% off", qty: 2, unit_price: 1000,
      discount_pct: 10, discount_kind: "percent", discount_amount: 0, vat_rate: 15, sort_order: 0,
      line_kind: "service", price_includes_vat: true },
    { product_id: null, title: "1000 minus Rs 50", qty: 1, unit_price: 1000,
      discount_pct: 0, discount_kind: "amount", discount_amount: 50, vat_rate: 15, sort_order: 1,
      line_kind: "service", price_includes_vat: true },
  ]);
  const [l2a, l2b] = await linesOf(d2.id);
  check("2 × 1000 at 10% → incl", l2a.incl, "1800.00");
  check("1000 − Rs 50 → incl", l2b.incl, "950.00");
  check("document total", d2.total_incl, "2750.00");

  console.log("▸ an UNFLAGGED line still behaves exactly as before");
  const d3 = await draft([{ product_id: null, title: "net path", qty: 1, unit_price: 869.57,
    discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15, sort_order: 0,
    line_kind: "service" }]);
  const [l3] = await linesOf(d3.id);
  check("net 869.57 grosses to 1000.01 (the old behaviour, preserved)", l3.incl, "1000.01");
  check("flag defaulted false", l3.price_includes_vat, "false");

  console.log("▸ the allowance reads a flagged line's gross without drift");
  // A flagged carwash line at the 5% cap must sit EXACTLY on its ceiling.
  const prod = (await c.query(
    `insert into public.products (tenant_id, name, kind, discount_policy, selling_price, vat_rate)
     values ($1,'PROBE wash','service','carwash',1000,15) returning id`, [TENANT],
  )).rows[0].id;
  const d4 = await draft([{ product_id: prod, title: "wash at the cap", qty: 1, unit_price: 1000,
    discount_pct: 5, discount_kind: "percent", discount_amount: 0, vat_rate: 15, sort_order: 0,
    price_includes_vat: true }]);
  const lim = (await c.query("select * from app.document_discount_limits($1)", [d4.id])).rows[0];
  check("ceiling = 5% of the typed gross", lim.ceiling_incl, "50.00");
  check("actual = the same 50.00 — no phantom cent", lim.actual_incl, "50.00");

  console.log(`\n${failures === 0 ? "ALL GOOD" : `${failures} FAILURE(S)`} — nothing persisted (rolled back)`);
} catch (e) {
  failures++;
  console.error("✗ probe blew up:", e.message);
} finally {
  await c.query("rollback");
  await c.end();
}
process.exitCode = failures === 0 ? 0 : 1;
