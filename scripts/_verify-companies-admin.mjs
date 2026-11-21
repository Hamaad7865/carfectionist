// Applies 20261124000010_companies_admin.sql inside ONE transaction on the live database, proves
// save_legal_entity on the TEST Sandbox as its owner, then ROLLS BACK. Nothing is kept.
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-companies-admin.mjs
import fs from "node:fs";
import pg from "pg";

const SANDBOX = "22222222-2222-4222-8222-000000000002";
const SANDBOX_OWNER = "b729191b-1159-4d46-88c7-3c9aceb5e664";
const SERVICE_PRODUCT = "948e53f4-54ba-4f11-80c1-7059b3735604";
const CAR_OWNER = "3668d8c3-75cc-402e-8fa5-143460857959";
const LIVE = "11111111-1111-4111-8111-000000000001";
const sql = fs.readFileSync("supabase/migrations/20261124000010_companies_admin.sql", "utf8");

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${JSON.stringify(got)}${ok ? "" : `  (want ${JSON.stringify(want)})`}`);
};
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const one = async (text, params) => (await c.query(text, params)).rows[0];
const asOwner = async () => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: SANDBOX_OWNER, role: "authenticated" })]);
};
const asAdmin = () => c.query("reset role");
const save = (p) => one("select * from public.save_legal_entity($1::jsonb)", [JSON.stringify(p)]);
const refuses = async (label, fn, needle) => {
  await c.query("savepoint r");
  try { await fn(); failures++; console.log(`  ✗ ${label}: was ALLOWED`); }
  catch (e) {
    const ok = !needle || e.message.includes(needle);
    if (!ok) failures++;
    console.log(`  ${ok ? "✓" : "✗"} ${label}: refused — ${e.message}`);
  }
  await c.query("rollback to savepoint r");
};
const base = { legal_name: "TEST Wheel Services Ltd", trading_name: "TEST Wheel Services", brn: "C99999999",
  vat_registered: false, vat_number: "VAT-SHOULD-DROP", vat_rate: 15, quote_prefix: "TESTWQ-", invoice_prefix: "TESTWS-", credit_note_prefix: "TESTWCN-" };

try {
  await c.query("begin");
  await c.query("set local lock_timeout = '5s'");
  const liveBefore = await one("select count(*) n, max(updated_at) u from legal_entities where tenant_id = $1", [LIVE]);
  const liveProdsBefore = await one("select md5(string_agg(id::text || ':' || coalesce(vat_rate::text, '-'), ',' order by id)) h from products where tenant_id = $1", [LIVE]);
  await c.query(sql);
  console.log("✓ migration applied");
  check("anonymous visitors cannot call it", (await one("select has_function_privilege('anon', 'public.save_legal_entity(jsonb)', 'execute') x")).x, false);

  await asOwner();
  console.log("\nAdding a company:");
  const svc = await save(base);
  check("added, not the default, after the tyre company", `${svc.is_default} ${svc.sort_order > 0}`, "false true");
  check("not VAT-registered → 0% and no VAT number, whatever was sent", `${svc.vat_rate} ${svc.vat_number}`, "0.00 null");
  check("its own series from 1", `${svc.invoice_prefix}${svc.invoice_next_number}`, "TESTWS-1");
  check("audit trail", (await one("select count(*) n from audit_events where ref_id = $1 and event_type = 'company_added'", [svc.id])).n, 1);
  await refuses("a prefix another company uses", () => save({ ...base, legal_name: "Dup", invoice_prefix: "TESTINV-", quote_prefix: "TESTX-", credit_note_prefix: "TESTXCN-" }), "prefixes");
  await refuses("no legal name", () => save({ ...base, legal_name: " " }), "legal name");
  await refuses("no invoice prefix", () => save({ ...base, legal_name: "X", invoice_prefix: "" }), "invoice prefix");
  const def = await one("select id from legal_entities where tenant_id = $1 and is_default", [SANDBOX]);
  await refuses("the main company is edited in Business profile", () => save({ ...base, id: def.id }), "Business profile");

  console.log("\nEditing before it has issued anything:");
  const e1 = await save({ ...base, id: svc.id, invoice_prefix: "TESTSV-", invoice_next_number: 120, phone: "5000 0000" });
  check("prefix and starting number may still change", `${e1.invoice_prefix}${e1.invoice_next_number} ${e1.phone}`, "TESTSV-120 5000 0000");

  console.log("\nProducts follow their company's VAT status:");
  const vatCo = await save({ ...base, legal_name: "TEST VAT Co", vat_registered: true, vat_number: "VAT77", quote_prefix: "TESTVQ-", invoice_prefix: "TESTVI-", credit_note_prefix: "TESTVC-" });
  await asAdmin();
  await c.query("update products set legal_entity_id = $1, vat_rate = null where id = $2", [vatCo.id, SERVICE_PRODUCT]);
  check("sold by a VAT-registered company → keeps the default rate", (await one("select vat_rate from products where id = $1", [SERVICE_PRODUCT])).vat_rate, null);
  await asOwner();
  await save({ ...base, id: vatCo.id, legal_name: "TEST VAT Co", vat_registered: false, quote_prefix: "TESTVQ-", invoice_prefix: "TESTVI-", credit_note_prefix: "TESTVC-" });
  check("company deregistered before issuing → its product drops to 0%", (await one("select vat_rate from products where id = $1", [SERVICE_PRODUCT])).vat_rate, "0.00");
  await save({ ...base, id: vatCo.id, legal_name: "TEST VAT Co", vat_registered: true, vat_number: "VAT77", quote_prefix: "TESTVQ-", invoice_prefix: "TESTVI-", credit_note_prefix: "TESTVC-" });
  check("registered again → back to the default rate", (await one("select vat_rate from products where id = $1", [SERVICE_PRODUCT])).vat_rate, null);
  await asAdmin();
  await c.query("update products set legal_entity_id = $1, vat_rate = 15 where id = $2", [svc.id, SERVICE_PRODUCT]);
  check("moved to the non-VAT company with 15% typed → stored 0%", (await one("select vat_rate from products where id = $1", [SERVICE_PRODUCT])).vat_rate, "0.00");
  await asOwner();

  console.log("\nThe product sheet's sold_by column (shelf prices, VAT-inclusive):");
  await asAdmin();
  const sku = (await one("update products set sku = coalesce(sku, 'TESTPROOF-SVC') where id = $1 returning sku", [SERVICE_PRODUCT])).sku;
  await asOwner();
  const imp = (rows) => one("select public.import_products($1::jsonb, false, true) r", [JSON.stringify(rows)]).then((x) => x.r);
  const prod = () => one("select selling_price, vat_rate, legal_entity_id from products where id = $1", [SERVICE_PRODUCT]);
  check("this proof's product has a SKU", Boolean(sku), true);
  await imp([{ sku, sold_by: "test wheel services ltd", selling_price: "1150" }]);
  let pr = await prod();
  check("sold by the non-VAT company (by name) → Rs 1,150 kept, 0%", `${pr.selling_price} ${pr.vat_rate} ${pr.legal_entity_id === svc.id}`, "1150.00 0.00 true");
  await imp([{ sku, sold_by: "TESTVI-", selling_price: "1150" }]);
  pr = await prod();
  check("sold by the VAT company (by invoice prefix) → net Rs 1,000, default rate", `${pr.selling_price} ${pr.vat_rate} ${pr.legal_entity_id === vatCo.id}`, "1000.00 null true");
  await imp([{ sku, selling_price: "2300" }]);
  pr = await prod();
  check("a sheet without sold_by leaves the company as it is", `${pr.selling_price} ${pr.legal_entity_id === vatCo.id}`, "2000.00 true");
  const bad = await imp([{ sku, sold_by: "Nobody Ltd", selling_price: "1" }]);
  check("an unknown company is reported, row skipped", `${bad.skipped} ${JSON.stringify(bad.errors).includes("is not one of")}`, "1 true");
  check("…and the product is unchanged", (await prod()).selling_price, "2000.00");
  await asAdmin();
  check("anonymous visitors cannot call the import", (await one("select has_function_privilege('anon', 'public.import_products(jsonb, boolean, boolean)', 'execute') x")).x, false);
  await c.query("update products set legal_entity_id = $1 where id = $2", [svc.id, SERVICE_PRODUCT]);
  await asOwner();

  console.log("\nOnce it has issued an invoice:");
  await c.query("update products set legal_entity_id = $1 where id = $2", [svc.id, SERVICE_PRODUCT]).catch(async () => {
    await asAdmin(); await c.query("update products set legal_entity_id = $1 where id = $2", [svc.id, SERVICE_PRODUCT]); await asOwner();
  });
  await asAdmin();
  await c.query("update products set legal_entity_id = $1 where id = $2", [svc.id, SERVICE_PRODUCT]);
  await c.query("update trading_days set status = 'open' where tenant_id = $1 and business_date = app.mu_today() and status = 'closed'", [SANDBOX]);
  await c.query("update cash_sessions set status = 'closed', closed_at = now() where tenant_id = $1 and status = 'open'", [SANDBOX]);
  await asOwner();
  const till = (await one("select (public.back_office_till()).id")).id;
  const d = { id: null, doc_type: "invoice", customer_id: CAR_OWNER, vehicle_id: null, template_id: null, template_overrides: {},
    valid_until: null, due_date: null, origin: "standalone", discount_kind: null, discount_value: 0, discount_reason: null };
  const draft = (await one("select (public.save_draft($1::jsonb, $2::jsonb, null)).id", [JSON.stringify(d), JSON.stringify([{
    product_id: SERVICE_PRODUCT, vehicle_id: null, title: "Alignment", description: null, description_richtext: null, unit_label: null,
    qty: 1, unit_price: 1300, discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15, sort_order: 0,
    line_kind: null, price_includes_vat: false }])])).id;
  const inv = await one("select number from public.issue_checkout($1, null, 'vca:1', $2, null)", [draft, till]);
  check("its first invoice uses the edited series", inv.number, "TESTSV-0120");
  const edited = { ...base, id: svc.id, invoice_prefix: "TESTSV-", invoice_next_number: 121 };
  await refuses("its prefix can no longer change", () => save({ ...edited, invoice_prefix: "TESTZZ-" }), "can no longer change");
  await refuses("nor its VAT status", () => save({ ...edited, vat_registered: true, vat_number: "VAT1" }), "can no longer change");
  await refuses("nor its next number", () => save({ ...edited, invoice_next_number: 5 }), "can no longer change");
  const e2 = await save({ ...edited, brn: "C88888888", receipt_footer_text: "Merci" });
  check("its details (BRN, footer) still can", `${e2.brn} ${e2.receipt_footer_text}`, "C88888888 Merci");
  await refuses("cannot be switched off while products are sold by it", () => save({ ...edited, is_active: false }), "move them");

  await asAdmin();
  const liveAfter = await one("select count(*) n, max(updated_at) u from legal_entities where tenant_id = $1", [LIVE]);
  check("Carfectionist's company untouched", JSON.stringify(liveAfter), JSON.stringify(liveBefore));
  const liveProdsAfter = await one("select md5(string_agg(id::text || ':' || coalesce(vat_rate::text, '-'), ',' order by id)) h from products where tenant_id = $1", [LIVE]);
  check("Carfectionist's product VAT rates untouched", liveProdsAfter.h, liveProdsBefore.h);
} catch (e) {
  failures++;
  console.log(`✗ aborted: ${e.message}`);
} finally {
  await c.query("rollback");
  await c.end();
  console.log(failures ? `\n${failures} FAILED` : "\nALL GOOD (rolled back — nothing kept)");
  process.exitCode = failures ? 1 : 0;
}
