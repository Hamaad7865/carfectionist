// The tablet's quote, job-bill and collect paths on a two-company shop (phase G, part 3c), proved
// on the TEST Sandbox (which now has a second, non-VAT company: Wheel Services (TEST)) with the
// exact RPC calls and arguments the tablet sends. ONE transaction, ROLLED BACK — nothing is kept.
// The live shop is checked read-only (it must keep the one-company road).
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-tablet-bills-per-company.mjs
import pg from "pg";

const SANDBOX = "22222222-2222-4222-8222-000000000002";
const SANDBOX_OWNER = "b729191b-1159-4d46-88c7-3c9aceb5e664";
const LIVE = "11111111-1111-4111-8111-000000000001";
const TYRE_PRODUCT = "87530748-1b27-459a-9f20-ec7cf3e28e7f"; // the main (VAT) company
const CAR_OWNER = "3668d8c3-75cc-402e-8fa5-143460857959";
const CAR = "c79909e8-5c15-46b6-95c1-217a00ee9715";
const TECH = "7bdad541-a060-486d-8fb7-40cd366a48a1";

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${JSON.stringify(got)}${ok ? "" : `  (want ${JSON.stringify(want)})`}`);
};
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const q = async (text, params) => (await c.query(text, params)).rows;
const one = async (text, params) => (await c.query(text, params)).rows[0];
const refuses = async (label, text, params, needle) => {
  await c.query("savepoint r");
  try {
    await c.query(text, params);
    failures++;
    console.log(`  ✗ ${label}: was ALLOWED`);
  } catch (e) {
    const ok = !needle || e.message.includes(needle);
    if (!ok) failures++;
    console.log(`  ${ok ? "✓" : "✗"} ${label}: refused — ${e.message}`);
  }
  await c.query("rollback to savepoint r");
};
const asOwner = async () => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: SANDBOX_OWNER, role: "authenticated" })]);
};
const asAdmin = () => c.query("reset role");

const line = (productId, title, price, extra = {}) => ({
  product_id: productId, vehicle_id: null, title, description: null, description_richtext: null, unit_label: null,
  qty: 1, unit_price: price, discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15,
  sort_order: 0, line_kind: null, price_includes_vat: false, ...extra,
});
const draft = async (docType, lines, doc = {}) => {
  const d = { id: null, doc_type: docType, customer_id: CAR_OWNER, vehicle_id: null, template_id: null, template_overrides: {},
    valid_until: null, due_date: null, origin: "standalone", discount_kind: null, discount_value: 0, discount_reason: null, ...doc };
  return (await one("select (public.save_draft($1::jsonb, $2::jsonb, null)).id", [JSON.stringify(d), JSON.stringify(lines)])).id;
};

try {
  // The live shop keeps ONE company: the tablet's issueBill takes issue_document there, as always.
  console.log("Live shop (read-only):");
  check("one active company → issue_document road", (await one("select count(*) n from legal_entities where tenant_id = $1 and is_active", [LIVE])).n, 1);

  await c.query("begin");
  await c.query("set local lock_timeout = '5s'");
  const svc = (await one("select id from legal_entities where tenant_id = $1 and not is_default and is_active", [SANDBOX]))?.id;
  if (!svc) throw new Error("the sandbox has no second company — add Wheel Services (TEST) first");
  const tyreCo = (await one("select id from legal_entities where tenant_id = $1 and is_default", [SANDBOX])).id;
  const align = (await one("select id from products where tenant_id = $1 and legal_entity_id = $2 and name = 'WHEEL ALIGNMENT'", [SANDBOX, svc])).id;
  const mixed = () => [line(TYRE_PRODUCT, "Tyre 205/55R16", 2000, { qty: 2 }), line(align, "Wheel alignment", 1300, { sort_order: 1, vat_rate: 0 })];

  await asOwner();
  check("the sandbox owner sees two active companies → issue_checkout road",
    (await one("select count(*) n from legal_entities where is_active")).n, 2);
  let till;
  await c.query("savepoint till");
  try { till = (await one("select (public.back_office_till()).id")).id; }
  catch (e) {
    console.log(`  (desk till refused: ${e.message} — closing the sandbox's stale tills for this run)`);
    await c.query("rollback to savepoint till");
    await asAdmin();
    await c.query("update cash_sessions set status = 'closed', closed_at = now() where tenant_id = $1 and status = 'open'", [SANDBOX]);
    await asOwner();
    till = (await one("select (public.back_office_till()).id")).id;
  }

  // ── Quotes: One or Two ─────────────────────────────────────────────────────────────────────
  console.log("\nQuotes — One or Two:");
  // A draft may hold it (the cashier is still deciding); ISSUING it — the send — is refused.
  const discounted = await draft("quote", mixed(), { discount_kind: "percent", discount_value: 5, discount_reason: "verify" });
  await refuses("one quote covering both companies can't be issued with a bill discount",
    "select * from public.issue_document($1, null, $2, null)", [discounted, "vtb:qdisc"], "cannot cover two companies");
  const oneQuote = await draft("quote", mixed());
  const issuedOne = await one("select number, status from public.issue_document($1, null, $2, null)", [oneQuote, `vtb:q1`]);
  check("One quote: issued as a single quote over both companies", `${issuedOne.status} ${issuedOne.number?.startsWith("TESTQ-")}`, "issued true");
  const twoQuote = await draft("quote", mixed());
  // The tablet's splitDocumentByCompany decodes these columns (CheckoutBillDto).
  const parts = await q("select id, number, status, doc_type, total_incl, amount_paid, legal_entity_id from public.split_document_by_company($1)", [twoQuote]);
  check("Two quotes: one draft quote per company, tyres first", parts.map((p) => `${p.doc_type}/${p.status}/${p.legal_entity_id === tyreCo ? "tyre" : p.legal_entity_id === svc ? "svc" : "?"}`).join(" "),
    "quote/draft/tyre quote/draft/svc");
  check("  …the first keeps the quote's id; totals 4600 + 1300", `${parts[0].id === twoQuote} ${parts.map((p) => p.total_incl).join(" + ")}`, "true 4600.00 + 1300.00");
  const again = await q("select id from public.split_document_by_company($1)", [twoQuote]);
  check("  …re-splitting the first part finds one company left: itself", again.map((p) => p.id).join(" "), parts[0].id);
  // Each part now takes its own discount (re-saved on its own).
  const tenOff = await one("select (public.save_draft($1::jsonb, $2::jsonb, null)).discount_value v",
    [JSON.stringify({ id: parts[1].id, doc_type: "quote", customer_id: CAR_OWNER, vehicle_id: null, template_id: null, template_overrides: {},
      valid_until: null, due_date: null, origin: "standalone", discount_kind: "percent", discount_value: 10, discount_reason: "verify" }),
     JSON.stringify([line(align, "Wheel alignment", 1300, { vat_rate: 0 })])]);
  check("  …the service company's quote takes its own 10% discount", tenOff.v, "10.00");

  // ── Job bill / quote bill: issueBill → issue_checkout under "inv:<id>" ──────────────────────
  console.log("\nA job's bill over both companies:");
  const bill = await draft("invoice", mixed());
  await refuses("issue_document alone refuses it (the old tablet road)",
    "select * from public.issue_document($1, null, $2, $3)", [bill, `inv:${bill}`, till], "another company");
  const bills = await q("select id, number, status, doc_type, total_incl, amount_paid, legal_entity_id from public.issue_checkout($1, null, $2, $3, null)", [bill, `inv:${bill}`, till]);
  check("issue_checkout: two invoices, TESTINV then TESTWS", bills.map((b) => `${b.number?.replace(/\d+$/, "")}${b.status}`).join(" "), "TESTINV-issued TESTWS-issued");
  check("  …the job card's toast reads both numbers", bills.map((b) => b.number).join(" + ").includes(" + TESTWS-"), true);
  const replay = await q("select id from public.issue_checkout($1, null, $2, $3, null)", [bill, `inv:${bill}`, till]);
  check("  …a re-tap replays the same two", replay.map((b) => b.id).join(" "), bills.map((b) => b.id).join(" "));

  // ── Collect: the pad's figure across the group (record_checkout_payment) ───────────────────
  console.log("\nCollecting it at the till:");
  const ids = bills.map((b) => b.id);
  const dep = await one("select * from public.record_checkout_payment($1::uuid[], 'cash'::payment_method, 1180, 1180, null, $2, 'proportional', $3)", [ids, till, `vtb:pay:collect`]);
  const afterDep = await q("select amount_paid, status from documents where id = any($1::uuid[]) order by total_incl desc", [ids]);
  check("a Rs 1,180 deposit lands on both in proportion (920 + 260)", afterDep.map((d) => `${d.amount_paid}/${d.status}`).join(" "), "920.00/partly_paid 260.00/partly_paid");
  const rest = await one("select * from public.record_checkout_payment($1::uuid[], 'card'::payment_method, 4720, null, 'VERIFY', $2, 'proportional', $3)", [ids, till, `vtb:pay2:collect`]);
  const afterAll = await q("select status from documents where id = any($1::uuid[])", [ids]);
  check("the balance settles both bills", afterAll.map((d) => d.status).join(" "), "paid paid");
  check("  …each collect returns its payment ids (for the undo)", `${dep.payment_ids.length} ${rest.payment_ids.length}`, "2 2");

  // ── A bill issued BEFORE the pad: the till finds its sister bill and collects the visit ─────
  console.log("\nA bill issued earlier, collected with its sister bill:");
  const early = await draft("invoice", mixed());
  const earlyBills = await q("select id, number from public.issue_checkout($1, null, $2, $3, null)", [early, `inv:${early}`, till]);
  // The tablet's TO COLLECT read (with its two new columns) and its sister-bill read, as the owner.
  const row = await one("select legal_entity_id, checkout_group_id from documents where id = $1 and doc_type = 'invoice' and status = any('{draft,issued,partly_paid}')", [earlyBills[0].id]);
  check("TO COLLECT reads the bill's company and its visit", `${row.legal_entity_id === tyreCo} ${row.checkout_group_id === early}`, "true true");
  const sisters = await q("select id from documents where checkout_group_id = $1 and doc_type = 'invoice' and status = any('{issued,partly_paid}')", [row.checkout_group_id]);
  check("  …the sister-bill read finds both open bills", sisters.length, 2);
  await refuses("the OLD road — a Rs 5,000 deposit on the Rs 4,600 tyre bill alone — is refused",
    "select * from public.record_payment($1, 'cash'::payment_method, 5000, 5000, null, $2, null, $3)", [earlyBills[0].id, till, "vtb:old"], "");
  await c.query("savepoint dep");
  await c.query("select * from public.record_checkout_payment($1::uuid[], 'cash'::payment_method, 5000, 5000, null, $2, $3, $4)", [earlyBills.map((b) => b.id), till, tyreCo, "vtb:tyrefirst:collect"]);
  const tf = await q("select amount_paid from documents where id = any($1::uuid[]) order by total_incl desc", [earlyBills.map((b) => b.id)]);
  check("  …across the visit, Tyres first: 4,600 + 400", tf.map((d) => d.amount_paid).join(" + "), "4600.00 + 400.00");
  await c.query("rollback to savepoint dep");

  // ── Points on a draft that will split: refused BEFORE issue (checkout_document_ids) ─────────
  console.log("\nPoints:");
  const willSplit = await draft("invoice", mixed());
  check("checkout_document_ids sees two bills coming → the tablet refuses points first", (await q("select * from public.checkout_document_ids($1)", [willSplit])).length, 2);
  const oneCo = await draft("invoice", [line(TYRE_PRODUCT, "Tyre", 2000)]);
  check("  …a tyres-only draft stays one bill → points allowed", (await q("select * from public.checkout_document_ids($1)", [oneCo])).length, 1);

  // ── On account: a ready job's split draft is issued per company and handed over ────────────
  console.log("\nOn account:");
  const qd = await draft("quote", mixed(), { vehicle_id: CAR });
  const job = (await one("select id from public.convert_quote_to_job($1, $2, null, null)", [qd, TECH])).id;
  const jobDraft = (await one("select id from public.create_document_from_job($1, 'invoice')", [job])).id;
  await asAdmin(); await c.query("update jobs set status = 'ready', ready_at = now() where id = $1", [job]); await asOwner();
  const creditBills = await q("select id from public.issue_checkout($1, null, $2, $3, null)", [jobDraft, `vtb:credit:issue`, till]);
  check("the job's draft becomes two open invoices", (await q("select status from documents where id = any($1::uuid[])", [creditBills.map((b) => b.id)])).map((d) => d.status).join(" "), "issued issued");
  const delivered = await one("select public.deliver_on_account($1) ok", [creditBills[0].id]);
  check("deliver_on_account on the first bill hands the car over", `${delivered.ok} ${(await one("select status from jobs where id = $1", [job])).status}`, "true delivered");
  check("  …both bills stay open on the account", (await q("select status from documents where id = any($1::uuid[])", [creditBills.map((b) => b.id)])).map((d) => d.status).join(" "), "issued issued");
} catch (e) {
  failures++;
  console.error("✗ stopped:", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failures ? `\n${failures} FAILED — rolled back.` : "\nAll good — rolled back, nothing kept.");
process.exit(failures ? 1 : 0);
