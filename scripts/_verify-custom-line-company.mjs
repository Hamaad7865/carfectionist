// A custom (hand-typed) line names its company (migration 20261125000010), proved on the TEST
// Sandbox in ONE transaction that is ROLLED BACK — the migration is applied inside it and undone.
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-custom-line-company.mjs
import pg from "pg";
import fs from "node:fs";

const SANDBOX = "22222222-2222-4222-8222-000000000002";
const SANDBOX_OWNER = "b729191b-1159-4d46-88c7-3c9aceb5e664";
const LIVE = "11111111-1111-4111-8111-000000000001";
const TYRE_PRODUCT = "87530748-1b27-459a-9f20-ec7cf3e28e7f";
const CAR_OWNER = "3668d8c3-75cc-402e-8fa5-143460857959";

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${JSON.stringify(got)}${ok ? "" : `  (want ${JSON.stringify(want)})`}`);
};
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const q = async (t, p) => (await c.query(t, p)).rows;
const one = async (t, p) => (await c.query(t, p)).rows[0];
const asOwner = async () => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: SANDBOX_OWNER, role: "authenticated" })]);
};
const line = (productId, title, price, extra = {}) => ({
  product_id: productId, vehicle_id: null, title, description: null, description_richtext: null, unit_label: null,
  qty: 1, unit_price: price, discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15,
  sort_order: 0, line_kind: null, price_includes_vat: false, ...extra,
});
const draft = async (lines) => {
  const d = { id: null, doc_type: "invoice", customer_id: CAR_OWNER, vehicle_id: null, template_id: null, template_overrides: {},
    valid_until: null, due_date: null, origin: "standalone", discount_kind: null, discount_value: 0, discount_reason: null };
  return (await one("select (public.save_draft($1::jsonb, $2::jsonb, null)).id", [JSON.stringify(d), JSON.stringify(lines)])).id;
};

try {
  await c.query("begin");
  await c.query(fs.readFileSync("supabase/migrations/20261125000010_custom_line_company.sql", "utf8"));
  console.log("Migration applied inside the transaction.");
  const cos = await q("select id, vat_registered, is_default from legal_entities where tenant_id = $1 and is_active order by is_default desc", [SANDBOX]);
  const main = cos.find((x) => x.is_default), svc = cos.find((x) => !x.is_default);
  const liveCo = (await one("select id from legal_entities where tenant_id = $1 and is_active limit 1", [LIVE])).id;
  check("sandbox has two companies", cos.length, 2);
  await asOwner();
  const id = await draft([
    line(null, "Wheel alignment (custom)", 1000, { legal_entity_id: svc.id, sort_order: 0 }),
    line(null, "Valve caps (custom)", 50, { legal_entity_id: main.id, sort_order: 1 }),
    line(null, "No company named", 70, { sort_order: 2 }),
    line(TYRE_PRODUCT, "Catalogue tyre", 2950, { legal_entity_id: svc.id, sort_order: 3 }),
    line(null, "Another shop's company", 80, { legal_entity_id: liveCo, sort_order: 4 }),
    line(null, "Not a uuid... empty", 90, { legal_entity_id: "", sort_order: 5 }),
  ]);
  const rows = await q("select title, legal_entity_id, vat_rate from document_lines where document_id = $1 order by sort_order", [id]);
  const co = (r) => (r.legal_entity_id === svc.id ? "service" : r.legal_entity_id === main.id ? "main" : String(r.legal_entity_id));
  check("custom line naming the service company", co(rows[0]), "service");
  check("…and it carries no VAT", Number(rows[0].vat_rate), 0);
  check("custom line naming the main company", co(rows[1]), "main");
  check("…keeps 15% VAT", Number(rows[1].vat_rate), 15);
  check("custom line naming no company → main, as before", co(rows[2]), "main");
  check("catalogue line ignores a named company (its product's wins)", co(rows[3]), "main");
  check("another shop's company is ignored", co(rows[4]), "main");
  check("an empty company is ignored", co(rows[5]), "main");
  await c.query("reset role");
  check("save_draft still has one overload", (await one("select count(*) n from pg_proc where proname = 'save_draft'")).n, 1);
} catch (e) {
  failures++;
  console.log("✗ threw:", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failures ? `\n${failures} FAILED (rolled back)` : "\nAll green (rolled back — nothing kept).");
process.exit(failures ? 1 : 0);
