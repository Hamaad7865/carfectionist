// Proves the TEST Tyre Sandbox (scripts/setup-tyre-sandbox.mjs) behaves like the tyre centre, as its
// owner, inside ONE transaction that is ROLLED BACK — nothing is kept, no number is used:
//   · the owner signs in to the sandbox tenant and sees its two companies;
//   · a quote with a tyre and a wheel alignment issues as TWO quotes, TTQ-… (VAT 15%) and TSQ-…
//     (no VAT), linked as one visit — the same issue_checkout the web Issue button calls;
//   · the real shops' quote counters are untouched.
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-tyre-sandbox.mjs
import pg from "pg";

const T = "44444444-4444-4444-8444-000000000004";
const REAL = ["11111111-1111-4111-8111-000000000001", "1f060b86-ad63-4dc7-93fb-a1fdfae18b27"];

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${JSON.stringify(got)}${ok ? "" : `  (want ${JSON.stringify(want)})`}`);
};
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const one = async (text, params) => (await c.query(text, params)).rows[0];
const all = async (text, params) => (await c.query(text, params)).rows;

try {
  await c.query("begin");
  await c.query("set local lock_timeout = '5s'");
  const realBefore = await all("select id, quote_next_number from legal_entities where tenant_id = any($1) order by id", [REAL]);
  const owner = await one(
    "select au.auth_user_id from app_users au where au.tenant_id = $1 and au.role = 'owner' and au.is_active", [T],
  );
  const tyre = await one("select id, selling_price from products where tenant_id = $1 and name = 'TEST Tyre 205/55 R16'", [T]);
  const align = await one("select id, selling_price from products where tenant_id = $1 and name = 'Wheel alignment'", [T]);
  const cust = await one("select id from customers where tenant_id = $1 and name = 'Test Tyre Customer'", [T]);

  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: owner.auth_user_id, role: "authenticated" })]);

  console.log("\nThe owner lands in the sandbox and sees two companies:");
  check("current tenant", (await one("select app.current_tenant_id() t")).t, T);
  const cos = await all("select legal_name, vat_registered, quote_prefix from legal_entities where is_active order by sort_order");
  check("companies visible", cos.length, 2);
  check("company 1", `${cos[0]?.legal_name} · VAT ${cos[0]?.vat_registered} · ${cos[0]?.quote_prefix}`, "TEST Tyres Ltd — NOT A REAL COMPANY · VAT true · TTQ-");
  check("company 2", `${cos[1]?.legal_name} · VAT ${cos[1]?.vat_registered} · ${cos[1]?.quote_prefix}`, "TEST Tyre Services — NOT A REAL COMPANY · VAT false · TSQ-");

  console.log("\nA quote with 4 tyres and an alignment → two quotes:");
  const line = (p, title, qty, sort) => ({
    product_id: p.id, vehicle_id: null, title, description: null, description_richtext: null, unit_label: null,
    qty, unit_price: Number(p.selling_price), discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15,
    sort_order: sort, line_kind: null, price_includes_vat: false,
  });
  const draft = await one("select (public.save_draft($1::jsonb, $2::jsonb, null)).*", [
    JSON.stringify({ id: null, doc_type: "quote", customer_id: cust.id, vehicle_id: null, template_id: null, template_overrides: {},
      valid_until: null, due_date: null, origin: "standalone", discount_kind: null, discount_value: 0, discount_reason: null }),
    JSON.stringify([line(tyre, "TEST Tyre 205/55 R16", 4, 0), line(align, "Wheel alignment", 1, 1)]),
  ]);
  const parts = await all(
    "select number, legal_entity_id, checkout_group_id, total_incl, vat_total from public.issue_checkout($1, null, $2, null, null) order by number desc",
    [draft.id, `verify-tyre-sandbox-${Date.now()}`],
  );
  check("quotes issued", parts.length, 2);
  check("tyre quote", `${parts[0]?.number} · total ${parts[0]?.total_incl} · VAT ${parts[0]?.vat_total}`, "TTQ-00001 · total 17940.00 · VAT 2340.00");
  check("service quote", `${parts[1]?.number} · total ${parts[1]?.total_incl} · VAT ${parts[1]?.vat_total}`, "TSQ-00001 · total 800.00 · VAT 0.00");
  check("one visit", parts[0]?.checkout_group_id && parts[0]?.checkout_group_id === parts[1]?.checkout_group_id, true);

  await c.query("reset role");
  const realAfter = await all("select id, quote_next_number from legal_entities where tenant_id = any($1) order by id", [REAL]);
  check("real shops' quote counters untouched", JSON.stringify(realAfter) === JSON.stringify(realBefore), true);
} catch (e) {
  failures++;
  console.error("✗", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failures ? `\n✗ ${failures} check(s) failed (rolled back)` : "\n✓ ALL GOOD (rolled back — nothing kept)");
process.exitCode = failures ? 1 : 0;
