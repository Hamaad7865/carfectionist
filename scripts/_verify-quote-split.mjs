// Proves the automatic quote split on the TEST Sandbox, as its owner, inside ONE transaction that is
// ROLLED BACK — nothing is kept, no number is used:
//   · a quote whose lines two companies sell is issued as one quote PER COMPANY, each numbered in
//     its own company's series, linked as one visit; the first company's keeps the draft's id;
//   · each company's own discount — stored on the draft in template_overrides.companyDiscounts by
//     the builder — lands on that company's quote only (the same p_discounts issueAcrossCompanies
//     builds); a non-VAT company's quote carries no VAT;
//   · the figures are the ones the builder previewed (company-split.test.ts holds the same fixture);
//   · a retry under the same key returns the same quotes; a bill discount spanning both is refused;
//   · a hand-typed line goes to the draft's stored company (the builder's lineCompanyId mirror);
//   · a one-company quote stays ONE quote; Carfectionist's live numbers are untouched.
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-quote-split.mjs
import pg from "pg";

const SANDBOX = "22222222-2222-4222-8222-000000000002";
const SANDBOX_OWNER = "b729191b-1159-4d46-88c7-3c9aceb5e664";
const GOODS_PRODUCT = "87530748-1b27-459a-9f20-ec7cf3e28e7f"; // no company set → the default company
const CAR_OWNER = "3668d8c3-75cc-402e-8fa5-143460857959";
const LIVE = "11111111-1111-4111-8111-000000000001";

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
const header = (extra = {}) => ({
  id: null, doc_type: "quote", customer_id: CAR_OWNER, vehicle_id: null, template_id: null, template_overrides: {},
  valid_until: null, due_date: null, origin: "standalone", discount_kind: null, discount_value: 0, discount_reason: null, ...extra,
});
const saveDraft = async (doc, lines) => one("select (public.save_draft($1::jsonb, $2::jsonb, null)).*", [JSON.stringify(doc), JSON.stringify(lines)]);
// What lib/supabase/issue-across-companies.ts hands issue_checkout: the stored per-company
// discounts (toCheckoutDiscounts — amount cents → rupees), for the companies on the draft only.
const pDiscounts = (stored, companyIds) =>
  companyIds.flatMap((id) => {
    const d = stored?.[id];
    if (!d || !(d.value > 0)) return [];
    return [{ legal_entity_id: id, discount_kind: d.kind, discount_value: d.kind === "amount" ? d.value / 100 : d.value, discount_reason: d.reason ?? null }];
  });
const issueAcross = async (docId, key) => {
  const d = await one("select template_overrides from documents where id = $1", [docId]);
  const plan = await all("select legal_entity_id from public.checkout_document_ids($1)", [docId]);
  const disc = plan.length > 1 ? pDiscounts(d.template_overrides?.companyDiscounts, plan.map((p) => p.legal_entity_id)) : [];
  return all(
    "select id, number, status, legal_entity_id, checkout_group_id, total_incl, vat_total, discount_kind, discount_value, discount_reason from public.issue_checkout($1, null, $2, null, $3::jsonb)",
    [docId, key, disc.length ? JSON.stringify(disc) : null],
  );
};

try {
  await c.query("begin");
  await c.query("set local lock_timeout = '5s'");
  const liveBefore = await one("select quote_next_number q from legal_entities where tenant_id = $1 and is_default", [LIVE]);
  const cos = await all("select id, quote_prefix, quote_next_number, vat_registered, is_default from legal_entities where tenant_id = $1 and is_active order by sort_order, id", [SANDBOX]);
  if (cos.length < 2) throw new Error("the sandbox needs a second active company (Settings → Companies)");
  const main = cos.find((x) => x.is_default);
  const svc = cos.find((x) => !x.is_default && !x.vat_registered) ?? cos.find((x) => !x.is_default);
  const svcProduct = (await one("select id from products where tenant_id = $1 and legal_entity_id = $2 and is_active limit 1", [SANDBOX, svc.id]))?.id;
  if (!svcProduct) throw new Error("the second company sells no product in the sandbox");
  await asOwner();

  console.log("\nA quote both companies sell → one quote per company:");
  const draft = await saveDraft(
    header({ template_overrides: { companyDiscounts: { [main.id]: { kind: "percent", value: 5, reason: "regular customer" } } } }),
    [line(GOODS_PRODUCT, "Rim brush", 2000, { qty: 2 }), line(svcProduct, "Wheel alignment", 1300, { sort_order: 1 })],
  );
  check("the draft itself carries no bill discount", draft.discount_kind, "null");
  const plan = await all("select legal_entity_id, document_id from public.checkout_document_ids($1)", [draft.id]);
  check("the plan: two companies, the default first", plan.map((p) => p.legal_entity_id === main.id ? "main" : p.legal_entity_id === svc.id ? "svc" : "?").join(","), "main,svc");
  const quotes = await issueAcross(draft.id, "qs:1");
  check("issued as two quotes", quotes.length, 2);
  const [mq, sq] = quotes;
  check("the default company's quote keeps the draft's id", mq.id === draft.id && mq.legal_entity_id === main.id, true);
  check("both are one visit (checkout group = the draft)", quotes.every((q) => q.checkout_group_id === draft.id), true);
  check("both issued", quotes.map((q) => q.status).join(","), "issued,issued");
  check("the default company's number is from its own series", mq.number.startsWith(main.quote_prefix), true);
  check("the second company's number is from ITS series", sq.number.startsWith(svc.quote_prefix), true);
  check("its own 5% lands on the default company's quote: (2 × 2,000 + 15%) − 5%", `${mq.discount_kind} ${mq.discount_value} ${mq.total_incl}`, "percent 5.00 4370.00");
  check("…with its reason", mq.discount_reason, "regular customer");
  check("the second company's quote: no discount, no VAT (not VAT-registered)", `${sq.discount_kind} ${sq.vat_total} ${sq.total_incl}`, svc.vat_registered ? `null ${sq.vat_total} ${sq.total_incl}` : "null 0.00 1300.00");
  const lines = await all("select d.id = $1 as main, l.title from document_lines l join documents d on d.id = l.document_id where d.id = any($2::uuid[]) order by l.sort_order", [draft.id, quotes.map((q) => q.id)]);
  check("each quote holds only its own company's lines", lines.map((l) => `${l.main ? "main" : "svc"}:${l.title}`).join(" | "), "main:Rim brush | svc:Wheel alignment");
  const replay = await issueAcross(draft.id, "qs:1");
  check("a retry under the same key returns the same two quotes", replay.map((q) => q.number).join(" + "), quotes.map((q) => q.number).join(" + "));

  console.log("\nA bill discount cannot cover two companies:");
  const billDisc = await saveDraft(header({ discount_kind: "percent", discount_value: 5, discount_reason: "x" }), [
    line(GOODS_PRODUCT, "Rim brush", 2000), line(svcProduct, "Wheel alignment", 1300, { sort_order: 1 }),
  ]);
  await c.query("savepoint r");
  let refused = "";
  try { await issueAcross(billDisc.id, "qs:2"); } catch (e) { refused = e.message; }
  await c.query("rollback to savepoint r");
  check("refused — the builder moves it to each company instead", refused.includes("cannot cover two companies"), true);

  console.log("\nA hand-typed line goes to the draft's stored company (lineCompanyId mirror):");
  const adhoc = (sort) => line(null, "Valve caps", 50, { line_kind: "product", sort_order: sort });
  let d = await saveDraft(header(), [line(svcProduct, "Wheel alignment", 1300)]);
  check("a draft whose lines one company sells follows it", d.legal_entity_id, svc.id);
  d = await saveDraft(header({ id: d.id }), [line(svcProduct, "Wheel alignment", 1300), adhoc(1)]);
  let ents = await all("select title, legal_entity_id from document_lines where document_id = $1 order by sort_order", [d.id]);
  check("…so a hand-typed line added next is that company's too (one quote)", ents.map((l) => l.legal_entity_id === svc.id).join(","), "true,true");
  let d2 = await saveDraft(header(), [adhoc(0)]);
  check("a new draft with only a hand-typed line is the default company's", d2.legal_entity_id, main.id);
  d2 = await saveDraft(header({ id: d2.id }), [adhoc(0), line(svcProduct, "Wheel alignment", 1300, { sort_order: 1 })]);
  ents = await all("select legal_entity_id from document_lines where document_id = $1 order by sort_order", [d2.id]);
  check("…and keeps it when the other company's product joins (two quotes)", `${ents[0].legal_entity_id === main.id} ${ents[1].legal_entity_id === svc.id}`, "true true");

  console.log("\nA one-company quote stays one quote:");
  const solo = await saveDraft(header(), [line(GOODS_PRODUCT, "Rim brush", 2000)]);
  const soloIssued = await issueAcross(solo.id, "qs:3");
  check("one quote, the draft's own id, the default series", `${soloIssued.length} ${soloIssued[0].id === solo.id} ${soloIssued[0].number.startsWith(main.quote_prefix)}`, "1 true true");

  await asAdmin();
  const liveAfter = await one("select quote_next_number q from legal_entities where tenant_id = $1 and is_default", [LIVE]);
  check("Carfectionist's quote numbers untouched", liveAfter.q, liveBefore.q);
} catch (e) {
  failures++;
  console.log(`✗ aborted: ${e.message}`);
} finally {
  await c.query("rollback");
  await c.end();
  console.log(failures ? `\n${failures} FAILED` : "\nALL GOOD (rolled back — nothing kept)");
  process.exitCode = failures ? 1 : 0;
}
