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

  console.log("▸ a line's allowance follows its policy");
  const svc = (await c.query(
    "insert into public.products (tenant_id, name, kind, selling_price, discount_policy) values ($1,'probe polish','service',1000,'inherit') returning id", [tenant],
  )).rows[0].id;
  const wash = (await c.query(
    "insert into public.products (tenant_id, name, kind, selling_price, discount_policy) values ($1,'probe wash','service',1000,'carwash') returning id", [tenant],
  )).rows[0].id;
  const goods = (await c.query(
    "insert into public.products (tenant_id, name, kind, selling_price, discount_policy) values ($1,'probe cologne','product',1000,'inherit') returning id", [tenant],
  )).rows[0].id;

  const line = (productId, over) => ({
    product_id: productId, title: "probe", description: null, qty: 1, unit_price: 1000,
    discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15, ...over,
  });
  const limitsFor = async (lines, docOver = {}) => {
    const d = (await c.query("select * from public.save_draft($1::jsonb, $2::jsonb, null)", [
      JSON.stringify({ ...doc, id: null, discount_reason: null, ...docOver }),
      JSON.stringify(lines.map((l, i) => ({ ...l, sort_order: i }))),
    ])).rows[0];
    const lim = (await c.query("select * from app.document_discount_limits($1::uuid)", [d.id])).rows[0];
    return { id: d.id, ...lim };
  };

  // Rs 1,000 ex-VAT at 15% = Rs 1,150 inclusive.
  const onlyService = await limitsFor([line(svc)]);
  check("a service allows nothing", Number(onlyService.ceiling_incl), 0);

  const onlyWash = await limitsFor([line(wash)]);
  check("a carwash allows 5% of its gross", Number(onlyWash.ceiling_incl), 57.5);
  check("that 5% is not 'free'", Number(onlyWash.free_incl), 0);

  const onlyGoods = await limitsFor([line(goods)]);
  check("goods allow the whole line", Number(onlyGoods.ceiling_incl), 1150);
  check("goods are free allowance", Number(onlyGoods.free_incl), 1150);

  const mixed = await limitsFor([line(svc), line(goods)]);
  check("a mixed document sums its lines", Number(mixed.ceiling_incl), 1150);

  console.log("▸ an undiscounted document shows no phantom discount");
  check("actual is exactly zero", Number(mixed.actual_incl), 0);
  const qty3 = await limitsFor([line(goods, { qty: 3 })]);
  check("and still zero at qty 3", Number(qty3.actual_incl), 0);

  // The qty-3 case above cannot actually catch a regression: when qty*unit_price is
  // already exact to the cent, rounding is commutative and the naive
  // round(qty*unit*1.15, 2) agrees with the two-step form to the last cent. qty is
  // numeric(12,3), so fractional quantities are reachable — and this is one that
  // diverges. The generated columns sum to 815.30; the naive gross gives 815.31 and
  // would report a 1-cent discount on a line that carries none, then demand a reason
  // for it. If this check ever fails, the gross derivation has been "simplified".
  const drifty = await limitsFor([line(goods, { qty: 1.25, unit_price: 567.17 })]);
  check("no phantom discount where a naive gross WOULD drift", Number(drifty.actual_incl), 0);

  console.log("▸ actual counts line and order discounts together");
  const both = await limitsFor(
    [line(goods, { discount_kind: "amount", discount_amount: 100 })],
    { discount_kind: "amount", discount_value: 50 },
  );
  check("Rs 100 off a line plus Rs 50 off the order", Number(both.actual_incl), 150);

  console.log("▸ an ad-hoc line falls back to its stated kind");
  const adhocSvc = await limitsFor([line(null, { line_kind: "service" })]);
  check("a typed service allows nothing", Number(adhocSvc.ceiling_incl), 0);
  const adhocGoods = await limitsFor([line(null, { line_kind: "product" })]);
  check("a typed product is free", Number(adhocGoods.ceiling_incl), 1150);

  console.log("▸ the guard raises exactly what the limits promise");
  const tryGuard = async (docId) => {
    let msg = null;
    await c.query("savepoint sg");
    try {
      await c.query("select app.assert_discount_allowed($1::uuid)", [docId]);
    } catch (e) { msg = e.message; }
    await c.query("rollback to savepoint sg");
    return msg;
  };

  const svcDisc = await limitsFor([line(svc, { discount_pct: 10 })]);
  check("a discounted service has something to refuse", Number(svcDisc.actual_incl) > 0, true);
  let msg = await tryGuard(svcDisc.id);
  check(
    "a service line discounted 10% raises 'discount exceeds allowance'",
    (msg ?? "").includes("discount exceeds allowance"), true,
  );

  const washAt5 = await limitsFor([line(wash)], { discount_kind: "percent", discount_value: 5 });
  check("a carwash at exactly 5% sits at its own ceiling", Number(washAt5.actual_incl), Number(washAt5.ceiling_incl));
  msg = await tryGuard(washAt5.id);
  check(
    "...but still raises 'a reason is required' with none on file",
    (msg ?? "").includes("reason is required"), true,
  );

  const washReasoned = await limitsFor(
    [line(wash)],
    { discount_kind: "percent", discount_value: 5, discount_reason: "regular customer" },
  );
  msg = await tryGuard(washReasoned.id);
  check("the same carwash line WITH a reason does not raise", msg, null);

  console.log("▸ an owner override raises the ceiling the guard reads");
  const ownerId = (await c.query(
    "select id from public.app_users where tenant_id=$1 and role='owner' and is_active limit 1", [tenant],
  )).rows[0].id;
  // owner_overrides has no INSERT policy for `authenticated` — record_owner_override (service_role,
  // PIN-checked) is the only sanctioned writer. Bypassing RLS here as the table owner is only to seed
  // the row for this probe of assert_discount_allowed's OWN logic, not to re-test that RPC.
  await c.query("set local role postgres");
  await c.query(
    `insert into public.owner_overrides (tenant_id, kind, ref_type, ref_id, scope, reason, approved_by)
     values ($1,'discount','document',$2,$3::jsonb,'owner allowed it on the spot',$4)`,
    [tenant, svcDisc.id, JSON.stringify({ max_discount_incl: 200 }), ownerId],
  );
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: AUTH, role: "authenticated" }),
  ]);
  msg = await tryGuard(svcDisc.id);
  check("an override covering Rs 115 of Rs 200 approved lets the same document through", msg, null);
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — nothing persisted (rolled back)." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
