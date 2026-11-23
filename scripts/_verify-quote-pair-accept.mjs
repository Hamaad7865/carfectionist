// Proves 20261126000010 on the TEST Sandbox, as its owner, inside ONE transaction that is ROLLED
// BACK — nothing is kept, no number is used. (Before the migration is pushed it is applied inside
// the same transaction, so the probe runs against exactly what the push would create.)
//   · a quote split per company is ONE agreement: signing either quote opens ONE job, from the
//     visit's first quote, and accepts every quote of the visit onto it; a retry hands back that job;
//   · accept_quote on either quote accepts both;
//   · billing either quote raises ONE draft bill with every company's lines, each keeping its
//     company, and each quote's discount as its company's discount; a retry hands it back;
//     issue_checkout then bills each company separately, at the figures the quotes showed;
//   · a quote that was never split is untouched: its own job, its own bill, as before;
//   · one definition per function name; the helpers are not callable by anon/authenticated.
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-quote-pair-accept.mjs
import { readFileSync } from "node:fs";
import pg from "pg";

const SANDBOX = "22222222-2222-4222-8222-000000000002";
const SANDBOX_OWNER = "b729191b-1159-4d46-88c7-3c9aceb5e664";
const GOODS_PRODUCT = "87530748-1b27-459a-9f20-ec7cf3e28e7f"; // no company set → the default company
const CAR_OWNER = "3668d8c3-75cc-402e-8fa5-143460857959";
const CAR = "c79909e8-5c15-46b6-95c1-217a00ee9715"; // TEST 1
const MIGRATION = new URL("../supabase/migrations/20261126000010_split_quote_pair_accepts_together.sql", import.meta.url);

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
  id: null, doc_type: "quote", customer_id: CAR_OWNER, vehicle_id: CAR, template_id: null, template_overrides: {},
  valid_until: null, due_date: null, origin: "standalone", discount_kind: null, discount_value: 0, discount_reason: null, ...extra,
});
const saveDraft = async (doc, lines) => one("select (public.save_draft($1::jsonb, $2::jsonb, null)).*", [JSON.stringify(doc), JSON.stringify(lines)]);
// issueAcrossCompanies: the stored per-company discounts (amount cents → rupees) as p_discounts.
const issueAcross = async (docId, key) => {
  const d = await one("select template_overrides from documents where id = $1", [docId]);
  const plan = await all("select legal_entity_id from public.checkout_document_ids($1)", [docId]);
  const stored = d.template_overrides?.companyDiscounts ?? {};
  const disc = plan.length < 2 ? [] : plan.flatMap(({ legal_entity_id: id }) => {
    const x = stored[id];
    if (!x || !(x.value > 0)) return [];
    return [{ legal_entity_id: id, discount_kind: x.kind, discount_value: x.kind === "amount" ? x.value / 100 : x.value, discount_reason: x.reason ?? null }];
  });
  return all(
    "select id, number, status, legal_entity_id, checkout_group_id, source_document_id, job_id, total_incl, vat_total, discount_kind, discount_value from public.issue_checkout($1, null, $2, null, $3::jsonb)",
    [docId, key, disc.length ? JSON.stringify(disc) : null],
  );
};
const SIG = { name: "TEST signer", png: "sandbox-probe" };

try {
  await c.query("begin");
  await c.query("set local lock_timeout = '5s'");
  const applied = (await one("select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'quote_pair_job'")).n > 0;
  if (!applied) {
    await c.query(readFileSync(MIGRATION, "utf8"));
    console.log("(migration applied inside the transaction — it will be rolled back)");
  }
  const cos = await all("select id, quote_prefix, invoice_prefix, vat_registered, is_default from legal_entities where tenant_id = $1 and is_active order by sort_order, id", [SANDBOX]);
  if (cos.length < 2) throw new Error("the sandbox needs a second active company");
  const main = cos.find((x) => x.is_default);
  const svc = cos.find((x) => !x.is_default);
  const svcProduct = (await one("select id from products where tenant_id = $1 and legal_entity_id = $2 and is_active limit 1", [SANDBOX, svc.id]))?.id;

  console.log("\nThe definitions:");
  const defs = await all("select p.proname, count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('accept_quote','convert_quote_to_job','convert_quote_to_invoice') group by 1 order by 1");
  check("one definition per name", defs.map((d) => `${d.proname}:${d.n}`).join(" "), "accept_quote:1 convert_quote_to_invoice:1 convert_quote_to_job:1");
  const leaky = await all("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname like any (array['quote_pair%','accept_quote_siblings']) and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))");
  check("no helper callable by anon/authenticated", leaky.length, 0);
  const anonKept = await all("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('accept_quote','convert_quote_to_job','convert_quote_to_invoice') and has_function_privilege('authenticated', p.oid, 'execute')");
  check("the public functions keep their grants", anonKept.length, 3);

  await asOwner();
  const split = async (key) => {
    const draft = await saveDraft(
      header({ template_overrides: { companyDiscounts: { [main.id]: { kind: "percent", value: 5, reason: "regular customer" } } } }),
      [line(GOODS_PRODUCT, "Rim brush", 2000, { qty: 2 }), line(svcProduct, "Wheel alignment", 1300, { sort_order: 1 })],
    );
    return issueAcross(draft.id, key);
  };

  console.log("\nSigning the SECOND company's quote of a split visit:");
  const [q1, q2] = await split("qpa:1");
  check("the visit is two quotes", `${q1.legal_entity_id === main.id} ${q2.legal_entity_id === svc.id}`, "true true");
  const job = await one("select * from public.convert_quote_to_job($1, null, null, $2::jsonb)", [q2.id, JSON.stringify(SIG)]);
  check("ONE job, opened from the visit's first quote", job.source_quote_id, q1.id);
  const jobs = await all("select id from jobs where source_quote_id = any($1::uuid[]) and status <> 'cancelled'", [[q1.id, q2.id]]);
  check("…and only one", jobs.length, 1);
  let qs = await all("select id, status, job_id, accepted_signature is not null signed from documents where id = any($1::uuid[]) order by id = $2 desc", [[q1.id, q2.id], q1.id]);
  check("both quotes accepted onto it, both signed", qs.map((q) => `${q.status}/${q.job_id === job.id}/${q.signed}`).join(" "), "accepted/true/true accepted/true/true");
  const dj = await all("select document_id from document_jobs where job_id = $1", [job.id]);
  check("the job lists both quotes", [q1.id, q2.id].every((id) => dj.some((r) => r.document_id === id)), true);
  const again = await one("select id from public.convert_quote_to_job($1, null, null, null)", [q1.id]);
  check("signing the other quote again hands back the same job", again.id, job.id);

  console.log("\nBilling the visit (from the second quote):");
  const inv = await one("select * from public.convert_quote_to_invoice($1)", [q2.id]);
  check("ONE draft bill, from the visit's first quote, on the job", `${inv.status} ${inv.source_document_id === q1.id} ${inv.job_id === job.id}`, "draft true true");
  const invLines = await all("select title, legal_entity_id from document_lines where document_id = $1 order by sort_order", [inv.id]);
  check("every company's lines, each keeping its company", invLines.map((l) => `${l.title}:${l.legal_entity_id === main.id ? "main" : l.legal_entity_id === svc.id ? "svc" : "?"}`).join(" | "), "Rim brush:main | Wheel alignment:svc");
  check("no bill discount; the quote's 5% is its company's", `${inv.discount_kind} ${JSON.stringify(inv.template_overrides?.companyDiscounts?.[main.id])}`, `null {"kind":"percent","value":5,"reason":"regular customer"}`);
  const invAgain = await one("select id from public.convert_quote_to_invoice($1)", [q1.id]);
  check("billing the other quote hands back the same bill", invAgain.id, inv.id);
  const bills = await issueAcross(inv.id, "qpa:bill:1");
  check("issued as one bill per company, each from its own series",
    `${bills.length} ${bills[0].number.startsWith(main.invoice_prefix)} ${bills[1].number.startsWith(svc.invoice_prefix)}`, "2 true true");
  check("at the figures the quotes showed", bills.map((b) => b.total_incl).join(" + "), `${q1.total_incl} + ${q2.total_incl}`);
  check("both bills on the job", bills.every((b) => b.job_id === job.id), true);
  const after = await one("select id from public.convert_quote_to_invoice($1)", [q2.id]);
  check("billing again after issue hands back an issued bill, no third", bills.some((b) => b.id === after.id), true);

  console.log("\naccept_quote on either quote accepts the visit:");
  const [p1, p2] = await split("qpa:2");
  await one("select id from public.accept_quote($1, $2::jsonb)", [p1.id, JSON.stringify(SIG)]);
  qs = await all("select status, accepted_signature is not null signed from documents where id = any($1::uuid[])", [[p1.id, p2.id]]);
  check("both accepted, both signed", qs.map((q) => `${q.status}/${q.signed}`).sort().join(" "), "accepted/true accepted/true");
  check("…and no job yet (signed, come back later)", (await all("select id from jobs where source_quote_id = any($1::uuid[])", [[p1.id, p2.id]])).length, 0);

  console.log("\nA declined quote refuses the visit's signature:");
  const [d1, d2] = await split("qpa:3");
  await asAdmin();
  await c.query("update documents set status = 'declined' where id = $1", [d2.id]);
  await asOwner();
  await c.query("savepoint r");
  let refused = "";
  try { await c.query("select public.convert_quote_to_job($1, null, null, null)", [d1.id]); } catch (e) { refused = e.message; }
  await c.query("rollback to savepoint r");
  check("refused, nothing half-done", /declined/.test(refused), true);

  console.log("\nA quote that was never split is untouched:");
  const solo = await saveDraft(header(), [line(GOODS_PRODUCT, "Rim brush", 2000)]);
  const [s1] = await issueAcross(solo.id, "qpa:4");
  check("no visit group", s1.checkout_group_id, "null");
  const soloJob = await one("select * from public.convert_quote_to_job($1, null, null, null)", [s1.id]);
  check("its own job, from itself", soloJob.source_quote_id, s1.id);
  const soloInv = await one("select * from public.convert_quote_to_invoice($1)", [s1.id]);
  check("its own bill, from itself, keeping no companyDiscounts", `${soloInv.source_document_id === s1.id} ${soloInv.template_overrides?.companyDiscounts === undefined}`, "true true");
  await asAdmin();
} catch (e) {
  failures++;
  console.log(`✗ aborted: ${e.message}`);
} finally {
  await c.query("rollback");
  await c.end();
  console.log(failures ? `\n${failures} FAILED` : "\nALL GOOD (rolled back — nothing kept)");
  process.exitCode = failures ? 1 : 0;
}
