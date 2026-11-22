// Proves the phase E paths on the TEST Sandbox as its owner, inside ONE transaction that is
// ROLLED BACK — nothing is kept, no live number is used:
//   · "Two quotes": a mixed draft quote split per company keeps each company's link after its
//     own discount is saved on it (save_draft), and each quote numbers in its own series;
//   · "Collect for the whole sale": a part payment fills the chosen company's bill first, then a
//     shared payment settles the rest — record_checkout_payment on the desk's till.
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-two-quotes-and-collect.mjs
import fs from "node:fs";
import pg from "pg";

const SANDBOX = "22222222-2222-4222-8222-000000000002";
const SANDBOX_OWNER = "b729191b-1159-4d46-88c7-3c9aceb5e664";
const TYRE_PRODUCT = "87530748-1b27-459a-9f20-ec7cf3e28e7f";
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
const all = async (text, params) => (await c.query(text, params)).rows;
const asOwner = async () => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: SANDBOX_OWNER, role: "authenticated" })]);
};
const asAdmin = () => c.query("reset role");
const line = (product_id, title, unit_price, extra = {}) => ({
  product_id, vehicle_id: null, title, description: null, description_richtext: null, unit_label: null,
  qty: 1, unit_price, discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15, sort_order: 0,
  line_kind: null, price_includes_vat: false, ...extra,
});
const header = (doc_type, extra = {}) => ({
  id: null, doc_type, customer_id: CAR_OWNER, vehicle_id: null, template_id: null, template_overrides: {},
  valid_until: null, due_date: null, origin: "standalone", discount_kind: null, discount_value: 0, discount_reason: null, ...extra,
});
const saveDraft = async (doc, lines) => (await one("select (public.save_draft($1::jsonb, $2::jsonb, null)).*", [JSON.stringify(doc), JSON.stringify(lines)]));
const doc = (id) => one("select id, number, status, total_incl, amount_paid, legal_entity_id, checkout_group_id, discount_value from documents where id = $1", [id]);

try {
  await c.query("begin");
  await c.query("set local lock_timeout = '5s'");
  const liveBefore = await one("select quote_next_number q, invoice_next_number i from legal_entities where tenant_id = $1 and is_default", [LIVE]);
  await c.query(sql);
  await asOwner();
  const svc = await one("select * from public.save_legal_entity($1::jsonb)", [JSON.stringify({
    legal_name: "TEST Wheel Services Ltd", vat_registered: false, quote_prefix: "TESTWQ-", invoice_prefix: "TESTWS-", credit_note_prefix: "TESTWCN-",
  })]);
  const tyreCo = await one("select id, quote_prefix, quote_next_number from legal_entities where tenant_id = $1 and is_default", [SANDBOX]);
  await asAdmin();
  await c.query("update products set legal_entity_id = $1 where id = $2", [svc.id, SERVICE_PRODUCT]);
  await c.query("update trading_days set status = 'open' where tenant_id = $1 and business_date = app.mu_today() and status = 'closed'", [SANDBOX]);
  await c.query("update cash_sessions set status = 'closed', closed_at = now() where tenant_id = $1 and status = 'open'", [SANDBOX]);
  await asOwner();

  console.log("\nTwo quotes — one per company, each with its own discount:");
  const draft = await saveDraft(header("quote"), [line(TYRE_PRODUCT, "Tyre 205/55R16", 2000, { qty: 2 }), line(SERVICE_PRODUCT, "Wheel alignment", 1300, { sort_order: 1 })]);
  const parts = await all("select id, legal_entity_id, checkout_group_id from public.split_document_by_company($1)", [draft.id]);
  check("split into two drafts", parts.length, 2);
  check("the tyre company keeps the draft's id", parts[0].id === draft.id && parts[0].legal_entity_id === tyreCo.id, true);
  check("both linked as one sale", parts.every((p) => p.checkout_group_id === draft.id), true);
  const svcPart = parts.find((p) => p.legal_entity_id === svc.id);
  await saveDraft(header("quote", { id: svcPart.id, discount_kind: "amount", discount_value: 100, discount_reason: "regular customer" }),
    [line(SERVICE_PRODUCT, "Wheel alignment", 1300)]);
  const sq = await doc(svcPart.id);
  check("the service quote's own discount: Rs 1,300 − Rs 100", sq.total_incl, "1200.00");
  check("…and it is still the service company's, still linked", `${sq.legal_entity_id === svc.id} ${sq.checkout_group_id === draft.id}`, "true true");
  check("the tyre quote is untouched: 2 × Rs 2,000 + 15% VAT", (await doc(draft.id)).total_incl, "4600.00");
  const tq = await one("select number from public.issue_document($1, null, null, null)", [draft.id]);
  const sqi = await one("select number from public.issue_document($1, null, null, null)", [svcPart.id]);
  check("the tyre quote numbers in the tyre series", tq.number.startsWith(tyreCo.quote_prefix), true);
  check("the service quote numbers in its own series", sqi.number, "TESTWQ-00001");

  console.log("\nCollect for the whole sale — a part payment, services first:");
  const till = (await one("select (public.back_office_till()).id")).id;
  const inv = await saveDraft(header("invoice"), [line(TYRE_PRODUCT, "Tyre 205/55R16", 2000, { qty: 2 }), line(SERVICE_PRODUCT, "Wheel alignment", 1300, { sort_order: 1 })]);
  const bills = await all("select id, number, legal_entity_id, total_incl from public.issue_checkout($1, null, 'tqc:1', $2, null)", [inv.id, till]);
  check("two invoices, one per company", bills.map((b) => b.total_incl).join(" + "), "4600.00 + 1300.00");
  const ids = bills.map((b) => b.id);
  const tyreBill = bills.find((b) => b.legal_entity_id === tyreCo.id).id;
  const svcBill = bills.find((b) => b.legal_entity_id === svc.id).id;
  await one("select * from public.record_checkout_payment($1::uuid[], 'cash', 2000, 2000, null, $2, $3, 'tqc:pay1')", [ids, till, svc.id]);
  let t = await doc(tyreBill), s = await doc(svcBill);
  check("Rs 2,000 services first → the service bill is paid", `${s.status} ${s.amount_paid}`, "paid 1300.00");
  check("…and the rest goes on the tyre bill", `${t.status} ${t.amount_paid}`, "partly_paid 700.00");
  await c.query("savepoint r");
  let refused = "";
  try { await one("select * from public.record_checkout_payment($1::uuid[], 'card', 3900, null, 'REF1', $2, 'proportional', 'tqc:pay2')", [[tyreBill, svcBill], till]); }
  catch (e) { refused = e.message; }
  await c.query("rollback to savepoint r");
  check("a paid bill can't be in the next payment (the panel offers open bills only)", refused.includes("open invoice"), true);
  await one("select * from public.record_checkout_payment($1::uuid[], 'card', 3900, null, 'REF1', $2, 'proportional', 'tqc:pay3')", [[tyreBill], till]);
  t = await doc(tyreBill);
  check("the remaining Rs 3,900 settles the tyre bill", `${t.status} ${t.amount_paid}`, "paid 4600.00");
  const pays = await one("select count(*) n, sum(amount) s from payments where document_id = any($1::uuid[])", [ids]);
  check("payments on the two bills add up to the sale", `${pays.s}`, "5900.00");

  await asAdmin();
  const liveAfter = await one("select quote_next_number q, invoice_next_number i from legal_entities where tenant_id = $1 and is_default", [LIVE]);
  check("Carfectionist's numbers untouched", JSON.stringify(liveAfter), JSON.stringify(liveBefore));
} catch (e) {
  failures++;
  console.log(`✗ aborted: ${e.message}`);
} finally {
  await c.query("rollback");
  await c.end();
  console.log(failures ? `\n${failures} FAILED` : "\nALL GOOD (rolled back — nothing kept)");
  process.exitCode = failures ? 1 : 0;
}
