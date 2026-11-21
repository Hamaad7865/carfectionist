// Applies 20261122000010_legal_entities.sql inside ONE transaction on the live database, proves
// it on the TEST Sandbox tenant, then ROLLS BACK. Nothing is kept: no company, no number, no row.
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-legal-entities.mjs
import fs from "node:fs";
import pg from "pg";

const SANDBOX = "22222222-2222-4222-8222-000000000002";
const SANDBOX_OWNER = "b729191b-1159-4d46-88c7-3c9aceb5e664";
const TYRE_PRODUCT = "87530748-1b27-459a-9f20-ec7cf3e28e7f"; // stays with the default company
const SERVICE_PRODUCT = "948e53f4-54ba-4f11-80c1-7059b3735604"; // moved to the non-VAT company here
const sql = fs.readFileSync("supabase/migrations/20261122000010_legal_entities.sql", "utf8");

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${JSON.stringify(got)}${ok ? "" : `  (want ${JSON.stringify(want)})`}`);
};
const refuses = async (c, label, q, params, needle) => {
  await c.query("savepoint s");
  try {
    await c.query(q, params);
    failures++;
    console.log(`  ✗ ${label}: was ALLOWED`);
  } catch (e) {
    const ok = !needle || e.message.includes(needle);
    if (!ok) failures++;
    console.log(`  ${ok ? "✓" : "✗"} ${label}: refused — ${e.message}`);
  }
  await c.query("rollback to savepoint s");
};

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const asOwner = async () => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: SANDBOX_OWNER, role: "authenticated" })]);
};
const asAdmin = () => c.query("reset role");

const line = (productId, title, price) => ({
  product_id: productId, vehicle_id: null, title, description: null, description_richtext: null, unit_label: null,
  qty: 1, unit_price: price, discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15,
  sort_order: 0, line_kind: null, price_includes_vat: false,
});
const draft = async (customerId, lines) => {
  const doc = { id: null, doc_type: "invoice", customer_id: customerId, vehicle_id: null, template_id: null, template_overrides: {},
    valid_until: null, due_date: null, origin: "standalone", discount_kind: null, discount_value: 0, discount_reason: null };
  return (await c.query("select (public.save_draft($1::jsonb, $2::jsonb, null)).id", [JSON.stringify(doc), JSON.stringify(lines)])).rows[0].id;
};
const issue = async (id) =>
  (await c.query("select number, vat_total, total_incl, legal_entity_id, issued_legal_name, issued_vat_number from public.issue_document($1, null, null, null)", [id])).rows[0];

try {
  await c.query("begin");
  await c.query("set local lock_timeout = '5s'");
  const before = (await c.query(
    "select id, quote_prefix||quote_next_number q, invoice_prefix||invoice_next_number i, credit_note_prefix||credit_note_next_number cn from business_settings order by id")).rows;

  await c.query(sql);
  console.log("✓ migration applied");

  console.log("\nEvery tenant keeps its next numbers:");
  const after = (await c.query(
    `select tenant_id id, quote_prefix||quote_next_number q, invoice_prefix||invoice_next_number i, credit_note_prefix||credit_note_next_number cn
       from legal_entities where is_default order by tenant_id`)).rows;
  for (const b of before) {
    const a = after.find((x) => x.id === b.id);
    check(`${b.id.slice(0, 8)} next quote / invoice / credit note`, a && `${a.q} ${a.i} ${a.cn}`, `${b.q} ${b.i} ${b.cn}`);
  }
  check("companies created (one per tenant)", (await c.query("select count(*) n from legal_entities")).rows[0].n, before.length);
  check("every backfilled company is VAT-registered", (await c.query("select bool_and(vat_registered) v from legal_entities")).rows[0].v, true);

  // A second, non-VAT company on the sandbox (as the admin role — the owner RPC is phase E).
  const svc = (await c.query(
    `insert into legal_entities (tenant_id, legal_name, brn, vat_registered, vat_number, vat_rate, quote_prefix, invoice_prefix, credit_note_prefix, sort_order)
     values ($1, 'TEST Wheel Services Ltd', 'C99999999', false, null, 0, 'TESTWQ-', 'TESTWS-', 'TESTWCN-', 1) returning id`, [SANDBOX])).rows[0].id;
  await c.query("update products set legal_entity_id = $1 where id = $2", [svc, SERVICE_PRODUCT]);
  const customer = (await c.query("select id from customers where tenant_id = $1 order by created_at limit 1", [SANDBOX])).rows[0].id;
  const defaultNext = (await c.query("select invoice_prefix||lpad(invoice_next_number::text, invoice_number_padding, '0') n from legal_entities where tenant_id=$1 and is_default", [SANDBOX])).rows[0].n;

  console.log("\nAs the sandbox owner:");
  await asOwner();
  const tyre = await issue(await draft(customer, [line(TYRE_PRODUCT, "Tyre-side item", 1000)]));
  check("default company invoice takes its existing series", tyre.number, defaultNext);
  check("  …with 15% VAT computed by the database", tyre.vat_total, "150.00");

  const service = await issue(await draft(customer, [line(SERVICE_PRODUCT, "Alignment", 1300)]));
  check("service invoice takes the service company's own series", service.number, "TESTWS-0001");
  check("  …and carries no VAT, though the line asked for 15%", service.vat_total, "0.00");
  check("  …total is the net price", service.total_incl, "1300.00");
  check("  …snapshot: the service company's name", service.issued_legal_name, "TEST Wheel Services Ltd");
  check("  …snapshot: no VAT number", service.issued_vat_number, null);
  check("  …belongs to the service company", service.legal_entity_id, svc);

  const service2 = await issue(await draft(customer, [line(SERVICE_PRODUCT, "Balancing", 170)]));
  check("next service invoice is gapless", service2.number, "TESTWS-0002");

  const mixed = await draft(customer, [line(TYRE_PRODUCT, "Tyre-side item", 1000), { ...line(SERVICE_PRODUCT, "Alignment", 1300), sort_order: 1 }]);
  await refuses(c, "an invoice mixing both companies cannot be issued", "select public.issue_document($1, null, null, null)", [mixed], "sold by another company");

  // A custom (no product) line given to the service company on a default-company draft is refused too.
  const custom = await draft(customer, [line(TYRE_PRODUCT, "Tyre-side item", 1000)]);
  await asAdmin();
  await c.query("insert into document_lines (tenant_id, document_id, title, qty, unit_price, vat_rate, sort_order, legal_entity_id) values ($1,$2,'Custom labour',1,100,15,5,$3)", [SANDBOX, custom, svc]);
  check("a custom line of the non-VAT company gets VAT 0", (await c.query("select vat_rate from document_lines where document_id=$1 and title='Custom labour'", [custom])).rows[0].vat_rate, "0.00");
  await asOwner();
  await refuses(c, "…and its draft cannot be issued under the other company", "select public.issue_document($1, null, null, null)", [custom], "sold by another company");

  // Credit note: in the credited invoice's company and credit-note series.
  await c.query("savepoint cn");
  try {
    const cn = (await c.query(
      "select number, legal_entity_id, vat_total from public.create_and_issue_credit_note((select id from documents where number = $1 and tenant_id = $2), null, false, null)",
      ["TESTWS-0001", SANDBOX])).rows[0];
    check("credit note on the service invoice uses the service credit-note series", cn.number, "TESTWCN-0001");
    check("  …and belongs to the service company", cn.legal_entity_id, svc);
    check("  …with no VAT", cn.vat_total, "0.00");
  } catch (e) {
    failures++;
    console.log(`  ✗ credit note: ${e.message}`);
    await c.query("rollback to savepoint cn");
  }

  await asAdmin();
  console.log("\nCarfectionist (live shop), unchanged:");
  const LIVE = "11111111-1111-4111-8111-000000000001";
  const liveNext = (await c.query("select invoice_prefix||lpad(invoice_next_number::text, invoice_number_padding, '0') n from business_settings where id=$1", [LIVE])).rows[0].n;
  const liveProduct = (await c.query("select id, name, selling_price from products where tenant_id=$1 and is_active and selling_price > 0 and not price_includes_vat order by name limit 1", [LIVE])).rows[0];
  const liveCustomer = (await c.query("select id from customers where tenant_id=$1 order by created_at limit 1", [LIVE])).rows[0].id;
  const liveId = (await c.query("select legal_name, vat_number from business_settings where id=$1", [LIVE])).rows[0];
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: "0eb870dc-ef5b-400a-8744-859c999a1b1b", role: "authenticated" })]);
  const live = await issue(await draft(liveCustomer, [line(liveProduct.id, liveProduct.name, Number(liveProduct.selling_price))]));
  check("next live invoice is exactly the number it would have been", live.number, liveNext);
  check("  …with 15% VAT as today", live.vat_total, (Math.round(Number(liveProduct.selling_price) * 15) / 100).toFixed(2));
  check("  …snapshot is the shop's own name and VAT number", `${live.issued_legal_name} / ${live.issued_vat_number}`, `${liveId.legal_name} / ${liveId.vat_number}`);
  await asAdmin();
  console.log("\nGuards:");
  await refuses(c, "the retired numbering seam refuses", "select app.next_document_number($1, 'invoice')", [SANDBOX], "retired");
  await refuses(c, "business_settings counters are frozen", "update business_settings set invoice_next_number = invoice_next_number + 1 where id = $1", [SANDBOX], "legal_entities");
  await refuses(c, "a non-VAT company cannot carry a VAT number", "update legal_entities set vat_number = 'X1' where id = $1", [svc], "legal_entities_vat_consistent");
  await refuses(c, "two companies cannot share an invoice prefix", "update legal_entities set invoice_prefix = 'TESTINV-' where id = $1", [svc], "legal_entities_invoice_prefix");
  await asOwner();
  await refuses(c, "a signed-in user cannot write companies directly", "update legal_entities set invoice_next_number = 1 where tenant_id = $1", [SANDBOX], "permission denied");
  check("a signed-in user sees only their own tenant's companies", (await c.query("select count(distinct tenant_id) n from legal_entities")).rows[0].n, 1);
  await asAdmin();

  await c.query(
    `insert into business_settings (id, legal_name, trading_name, country, vat_rate, prices_vat_exclusive, quote_prefix, quote_next_number,
       invoice_prefix, invoice_next_number, credit_note_prefix, credit_note_next_number, z_next_number, is_sandbox)
     values ('44444444-4444-4444-8444-000000000004', 'New Tenant Ltd', 'New Tenant', 'MU', 15, true, 'NQ-', 1, 'NINV-', 1, 'NCN-', 1, 1, true)`);
  check("a new tenant gets its default company", (await c.query("select invoice_prefix||invoice_next_number n from legal_entities where tenant_id='44444444-4444-4444-8444-000000000004' and is_default")).rows[0]?.n, "NINV-1");
  await c.query("update business_settings set phone = '+230 0000 0000' where id = $1", [SANDBOX]);
  check("a business-profile edit reaches the default company", (await c.query("select phone from legal_entities where tenant_id=$1 and is_default", [SANDBOX])).rows[0].phone, "+230 0000 0000");
} catch (e) {
  failures++;
  console.log(`✗ stopped: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(`\n${failures === 0 ? "ALL GOOD" : `${failures} FAILURE(S)`} — rolled back, nothing kept.`);
process.exit(failures ? 1 : 0);
