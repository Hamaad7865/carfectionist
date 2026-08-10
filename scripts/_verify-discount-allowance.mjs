// Rolled-back verification for the discount-allowance rules.
//
// The owner's rules: a service takes no discount, a carwash takes up to 5% and only
// with a reason, and the whole-document discount cannot go past the sum of what the
// lines allow. Runs as `authenticated` impersonating the owner, then ROLLS BACK.
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
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: AUTH, role: "authenticated" }),
  ]);

  const tenant = (await c.query("select app.current_tenant_id() as t")).rows[0].t;

  console.log("▸ a product states how it may be discounted");
  const cols = (await c.query(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='products' and column_name='discount_policy'`,
  )).rowCount;
  check("products.discount_policy exists", cols, 1);

  const dflt = (await c.query(
    `select column_default from information_schema.columns
      where table_schema='public' and table_name='products' and column_name='discount_policy'`,
  )).rows[0]?.column_default ?? "";
  check("it defaults to 'inherit'", dflt.startsWith("'inherit'"), true);

  let refused = "no";
  try {
    await c.query("savepoint s1");
    await c.query(
      "insert into public.products (tenant_id, name, kind, discount_policy) values ($1,'probe','service','nonsense')",
      [tenant],
    );
  } catch { refused = "yes"; }
  await c.query("rollback to savepoint s1");
  check("a nonsense policy is refused", refused, "yes");

  console.log("▸ a discount carries the reason it was given");
  const hasReason = (await c.query(
    `select 1 from information_schema.columns
      where table_schema='public' and table_name='documents' and column_name='discount_reason'`,
  )).rowCount;
  check("documents.discount_reason exists", hasReason, 1);

  const customer = (await c.query(
    "select id from public.customers where tenant_id = $1 order by created_at limit 1", [tenant],
  )).rows[0].id;
  const doc = {
    id: null, doc_type: "quote", customer_id: customer, vehicle_id: null, template_id: null,
    template_overrides: {}, valid_until: null, due_date: null, origin: "standalone",
    discount_kind: null, discount_value: 0, discount_reason: "regular customer",
  };
  const saved = (await c.query("select * from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify(doc),
    JSON.stringify([{
      product_id: null, title: "Wash", description: null, qty: 1, unit_price: 1000,
      discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15,
      sort_order: 0, line_kind: "service",
    }]),
  ])).rows[0];
  check("save_draft stores the reason", saved.discount_reason, "regular customer");
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — nothing persisted (rolled back)." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
