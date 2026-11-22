// What a custom line naming the non-VAT company does on TODAY's save_draft (migration
// 20261125000010 NOT applied) — the tablet sends legal_entity_id + vat_rate 0. Rolled back.
import pg from "pg";
const SANDBOX = "22222222-2222-4222-8222-000000000002";
const OWNER = "b729191b-1159-4d46-88c7-3c9aceb5e664";
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
try {
  await c.query("begin");
  const svc = (await c.query("select id from legal_entities where tenant_id = $1 and is_active and not is_default", [SANDBOX])).rows[0].id;
  const main = (await c.query("select id from legal_entities where tenant_id = $1 and is_active and is_default", [SANDBOX])).rows[0].id;
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: OWNER, role: "authenticated" })]);
  const d = { id: null, doc_type: "invoice", customer_id: null, vehicle_id: null, template_id: null, template_overrides: {}, valid_until: null, due_date: null, origin: "standalone", discount_kind: null, discount_value: 0, discount_reason: null };
  const l = { product_id: null, vehicle_id: null, title: "Custom service", description: null, description_richtext: null, unit_label: null, qty: 1, unit_price: 1000, discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 0, sort_order: 0, line_kind: null, price_includes_vat: false, legal_entity_id: svc };
  const id = (await c.query("select (public.save_draft($1::jsonb, $2::jsonb, null)).id", [JSON.stringify(d), JSON.stringify([l])])).rows[0].id;
  const r = (await c.query("select legal_entity_id, vat_rate from document_lines where document_id = $1", [id])).rows[0];
  console.log("company:", r.legal_entity_id === svc ? "service" : r.legal_entity_id === main ? "MAIN (VAT)" : r.legal_entity_id, " vat_rate:", r.vat_rate);
} catch (e) { console.log("threw:", e.message); }
finally { await c.query("rollback").catch(() => {}); await c.end(); }
