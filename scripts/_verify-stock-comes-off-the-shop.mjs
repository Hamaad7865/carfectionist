// Rolled-back check: a bill takes its goods off the SALES FLOOR — including when the
// caller names no location at all.
//
// This exists because I got it backwards. PosApi.issueDocument's comment said a null
// location "coalesces to the tenant default (Warehouse)", so I concluded every bill that
// was not a walk-in had been debiting the wrong shelf. It never was: issue_document's own
// coalesce puts the sales floor FIRST and reaches is_default only in a one-location shop.
// The comment was stale; the code was right. This pins the behaviour so the next person
// reading that comment can check it in ten seconds instead of believing it.
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
const saveDraft = async (doc, lines) =>
  (await c.query("with d as (select public.save_draft($1::jsonb, $2::jsonb) as r) select (r).id as id from d", [
    JSON.stringify(doc), JSON.stringify(lines),
  ])).rows[0].id;

try {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: AUTH, role: "authenticated" })]);

  const tenant = (await c.query("select app.current_tenant_id() as t")).rows[0].t;
  const customer = (await c.query("select id from public.customers where tenant_id = $1 order by created_at limit 1", [tenant])).rows[0].id;

  // The same choice PosApi.fetchShopLocationId makes, in the same order.
  const locs = (await c.query(
    "select id, name, is_default, is_sales_floor from public.stock_locations where tenant_id = $1",
    [tenant],
  )).rows;
  const shop = locs.find((l) => l.is_sales_floor) ?? locs.find((l) => l.name === "Shop") ?? locs.find((l) => !l.is_default);
  const fallback = locs.find((l) => l.is_default);

  console.log("a bill takes its goods off the sales floor");
  check("the shop floor exists", shop != null, "true");
  check("and is not the tenant default", shop?.id !== fallback?.id, "true");

  // a stocked product, so issuing it actually moves something
  const product = (await c.query(
    "select id, name, selling_price, vat_rate from public.products where tenant_id = $1 and is_stocked and kind <> 'service' order by created_at limit 1",
    [tenant],
  )).rows[0];
  check("a stocked product to sell", product != null, "true");

  const bill = await saveDraft(
    {
      id: null, doc_type: "invoice", customer_id: customer, vehicle_id: null, template_id: null,
      template_overrides: {}, valid_until: null, due_date: null, origin: "standalone",
      discount_kind: null, discount_value: 0,
    },
    [{
      product_id: product.id, title: product.name, description: null, description_richtext: null,
      unit_label: null, qty: 2, unit_price: Number(product.selling_price), discount_pct: 0,
      discount_kind: "percent", discount_amount: 0, vat_rate: Number(product.vat_rate ?? 15),
      sort_order: 0, line_kind: null,
    }],
  );

  // The case that matters: NO location named, exactly as a quote's or job's bill issues.
  await c.query("select * from public.issue_document($1::uuid, null, $2, null)", [bill, `probe:${bill}`]);

  const moves = (await c.query(
    "select location_id, qty, ref_type from public.stock_movements where ref_id = $1",
    [bill],
  )).rows;

  check("the sale moved stock", moves.length > 0, "true");
  check("off the sales floor, with nothing passed", moves.every((m) => m.location_id === shop.id), "true");
  check("and none off the default location", moves.some((m) => m.location_id === fallback?.id), "false");
  check("two off the shelf", moves.reduce((n, m) => n + Number(m.qty), 0), -2);

  // …and what the till reads — the sales floor's count — actually fell.
  const onFloor = (await c.query(
    "select coalesce(sum(qty), 0) as q from public.stock_movements where product_id = $1 and location_id = $2",
    [product.id, shop.id],
  )).rows[0].q;
  console.log(`  · ${product.name} now nets ${onFloor} on the sales floor (inside this transaction)`);

  // …and naming the floor explicitly, as the walk-in sale does, lands in the same place.
  const bill2 = await saveDraft(
    {
      id: null, doc_type: "invoice", customer_id: customer, vehicle_id: null, template_id: null,
      template_overrides: {}, valid_until: null, due_date: null, origin: "standalone",
      discount_kind: null, discount_value: 0,
    },
    [{
      product_id: product.id, title: product.name, description: null, description_richtext: null,
      unit_label: null, qty: 1, unit_price: Number(product.selling_price), discount_pct: 0,
      discount_kind: "percent", discount_amount: 0, vat_rate: Number(product.vat_rate ?? 15),
      sort_order: 0, line_kind: null,
    }],
  );
  await c.query("select * from public.issue_document($1::uuid, $2::uuid, $3, null)", [bill2, shop.id, `probe:${bill2}`]);
  const named = (await c.query("select location_id from public.stock_movements where ref_id = $1", [bill2])).rows;
  check("naming the floor lands in the same place", named.every((m) => m.location_id === shop.id), "true");
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — rolled back" : `\n${failures} FAILED — rolled back`);
process.exit(failures === 0 ? 0 : 1);
