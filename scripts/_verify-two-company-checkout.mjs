// Applies 20261123000010_two_company_checkout.sql inside ONE transaction on the live database,
// proves it on the TEST Sandbox tenant (a second, non-VAT company is created for the run), then
// ROLLS BACK. Nothing is kept. The live shop is checked read-only.
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-two-company-checkout.mjs
import fs from "node:fs";
import pg from "pg";

const SANDBOX = "22222222-2222-4222-8222-000000000002";
const SANDBOX_OWNER = "b729191b-1159-4d46-88c7-3c9aceb5e664";
const TYRE_PRODUCT = "87530748-1b27-459a-9f20-ec7cf3e28e7f"; // stays with the default (VAT) company
const SERVICE_PRODUCT = "948e53f4-54ba-4f11-80c1-7059b3735604"; // moved to the non-VAT company here
const CAR = "c79909e8-5c15-46b6-95c1-217a00ee9715", CAR_OWNER = "3668d8c3-75cc-402e-8fa5-143460857959";
const TECH = "7bdad541-a060-486d-8fb7-40cd366a48a1";
const LIVE = "11111111-1111-4111-8111-000000000001";
const sql = fs.readFileSync("supabase/migrations/20261123000010_two_company_checkout.sql", "utf8");

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
const step = async (label, fn) => {
  await c.query("savepoint s");
  try { await fn(); } catch (e) { failures++; console.log(`  ✗ ${label}: ${e.message}`); await c.query("rollback to savepoint s"); }
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
const draft = async (lines, doc = {}) => {
  const d = { id: null, doc_type: "invoice", customer_id: CAR_OWNER, vehicle_id: null, template_id: null, template_overrides: {},
    valid_until: null, due_date: null, origin: "standalone", discount_kind: null, discount_value: 0, discount_reason: null, ...doc };
  return (await one("select (public.save_draft($1::jsonb, $2::jsonb, null)).id", [JSON.stringify(d), JSON.stringify(lines)])).id;
};
const mixedLines = () => [
  line(TYRE_PRODUCT, "Tyre 205/55R16", 2000, { qty: 2 }),
  line(SERVICE_PRODUCT, "Wheel alignment", 1300, { sort_order: 1 }),
];
const checkout = (id, key, till, discounts = null) =>
  q(`select id, number, status, legal_entity_id, checkout_group_id, vat_total, total_incl, amount_paid, job_id
       from public.issue_checkout($1, null, $2, $3, $4::jsonb)`, [id, key, till, discounts && JSON.stringify(discounts)]);
const pay = (ids, method, amount, tendered, till, allocation, key) =>
  one(`select * from public.record_checkout_payment($1::uuid[], $2::payment_method, $3, $4, $5, $6, $7, $8)`,
      [ids, method, amount, tendered, method === "cash" ? null : "VERIFY", till, allocation, key]);
const docs = (ids) => q("select id, number, status, amount_paid, total_incl from documents where id = any($1::uuid[]) order by number", [ids]);
const next = (tenant, kind, def = true) => one(
  `select ${kind}_prefix || lpad(${kind}_next_number::text, ${kind}_number_padding, '0') n from legal_entities where tenant_id = $1 and is_default = $2`,
  [tenant, def]).then((r) => r.n);

try {
  await c.query("begin");
  await c.query("set local lock_timeout = '5s'");
  const billSeqBefore = (await one("select last_value from documents_bill_no_seq")).last_value;
  const liveBefore = await one(
    `select quote_prefix||quote_next_number q, invoice_prefix||invoice_next_number i, credit_note_prefix||credit_note_next_number cn
       from legal_entities where tenant_id = $1 and is_default`, [LIVE]);

  await c.query(sql);
  console.log("✓ migration applied");

  // ── the sandbox becomes a two-company shop for this run ────────────────────────────────────
  const svc = (await one(
    `insert into legal_entities (tenant_id, legal_name, brn, vat_registered, vat_number, vat_rate, quote_prefix, invoice_prefix, credit_note_prefix, sort_order)
     values ($1, 'TEST Wheel Services Ltd', 'C99999999', false, null, 0, 'TESTWQ-', 'TESTWS-', 'TESTWCN-', 1) returning id`, [SANDBOX])).id;
  const tyreCo = (await one("select id from legal_entities where tenant_id = $1 and is_default", [SANDBOX])).id;
  await c.query("update products set legal_entity_id = $1 where id = $2", [svc, SERVICE_PRODUCT]);
  await c.query("update trading_days set status = 'open' where tenant_id = $1 and business_date = app.mu_today() and status = 'closed'", [SANDBOX]);
  await asOwner();
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
  const tyreNext = await next(SANDBOX, "invoice");

  // ── 1. a mixed cart ────────────────────────────────────────────────────────────────────────
  console.log("\nOne cart, two companies:");
  const d1 = await draft(mixedLines());
  const preview = await q("select legal_entity_id, document_id from public.checkout_document_ids($1)", [d1]);
  const inv = await checkout(d1, "vtc:sale1", till);
  check("two invoices", inv.length, 2);
  check("tyres first: the VAT company, its own series continues", `${inv[0].number} ${inv[0].legal_entity_id === tyreCo}`, `${tyreNext} true`);
  check("  …15% VAT computed by the database (2 × 2000)", `${inv[0].vat_total} / ${inv[0].total_incl}`, "600.00 / 4600.00");
  check("services: the non-VAT company, its own first number", `${inv[1].number} ${inv[1].legal_entity_id === svc}`, "TESTWS-0001 true");
  check("  …no VAT", `${inv[1].vat_total} / ${inv[1].total_incl}`, "0.00 / 1300.00");
  check("both in one checkout group (= the draft)", `${inv[0].checkout_group_id === d1} ${inv[1].checkout_group_id === d1}`, "true true");
  check("the tyre bill kept the draft's id", inv[0].id, d1);
  check("checkout_document_ids named both ids in advance", JSON.stringify(preview.map((p) => p.document_id)), JSON.stringify(inv.map((i) => i.id)));
  const counters = await q("select invoice_next_number n from legal_entities where tenant_id = $1 order by sort_order", [SANDBOX]);
  const replay = await checkout(d1, "vtc:sale1", till);
  check("a replay returns the same two invoices", replay.map((r) => r.number).join(" "), inv.map((r) => r.number).join(" "));
  check("  …and draws no number", JSON.stringify(await q("select invoice_next_number n from legal_entities where tenant_id = $1 order by sort_order", [SANDBOX])), JSON.stringify(counters));

  // ── 2. one payment settles both ────────────────────────────────────────────────────────────
  console.log("\nOne payment, both bills:");
  const g1 = await pay(inv.map((i) => i.id), "cash", 5900, 6000, till, "proportional", "vtc:pay1");
  const after1 = await docs(inv.map((i) => i.id));
  check("both bills paid", after1.map((d) => d.status).join(" "), "paid paid");
  check("payment group: Rs 5,900 cash, tendered 6,000, change 100", `${g1.amount} ${g1.tendered} ${g1.change_given}`, "5900.00 6000.00 100.00");
  const parts = await q("select amount, tendered, change_given from payments where id = any($1::uuid[]) order by amount desc", [g1.payment_ids]);
  check("  …two payments of what each owed, the change on one only", JSON.stringify(parts), JSON.stringify([
    { amount: "4600.00", tendered: "4700.00", change_given: "100.00" }, { amount: "1300.00", tendered: "1300.00", change_given: "0.00" }]));
  const g1r = await pay(inv.map((i) => i.id), "cash", 5900, 6000, till, "proportional", "vtc:pay1");
  check("a replayed payment returns the same group, no new money", `${g1r.id === g1.id} ${(await one("select count(*) n from payments where document_id = any($1::uuid[])", [inv.map((i) => i.id)])).n}`, "true 2");

  // ── 3. part payments: tyres first, services first, both ────────────────────────────────────
  console.log("\nPart payments — staff choose where the money goes:");
  const part = async (label, allocation, amount, want) => {
    await step(label, async () => {
      await c.query("savepoint p");
      const ids = (await checkout(await draft(mixedLines()), null, till)).map((i) => i.id);
      await pay(ids, "card", amount, null, till, allocation, null);
      const got = await q(`select d.amount_paid, d.status from documents d where d.id = any($1::uuid[])
                           order by (select sort_order from legal_entities where id = d.legal_entity_id)`, [ids]);
      check(label, got.map((g) => `${g.amount_paid} ${g.status}`).join(" | "), want);
      await c.query("rollback to savepoint p");
    });
  };
  await part("Tyres first, Rs 5,000: tyres paid, Rs 400 to services", tyreCo, 5000, "4600.00 paid | 400.00 partly_paid");
  await part("Services first, Rs 2,000: services paid, Rs 700 to tyres", svc, 2000, "700.00 partly_paid | 1300.00 paid");
  await part("Both, Rs 2,950 (half of each): in proportion, to the cent", "proportional", 2950, "2300.00 partly_paid | 650.00 partly_paid");
  await part("Both, Rs 1,000: 4600:1300 → 779.66 / 220.34", "proportional", 1000, "779.66 partly_paid | 220.34 partly_paid");
  await part("Both, Rs 0.01: one bill takes the cent, the other no payment", "proportional", 0.01, "0.01 partly_paid | 0.00 issued");
  await step("overpaying is refused", async () => {
    const ids = (await checkout(await draft(mixedLines()), null, till)).map((i) => i.id);
    await refuses("  more than both bills owe", "select public.record_checkout_payment($1::uuid[], 'card', 6000, null, 'X', $2, 'proportional', null)", [ids, till], "exceeds outstanding");
    await refuses("  points across two companies", "select public.record_checkout_payment($1::uuid[], 'points', 10, null, null, $2, 'proportional', null)", [ids, till], "points pay one bill");
    await refuses("  an unknown allocation", "select public.record_checkout_payment($1::uuid[], 'card', 10, null, 'X', $2, 'cheapest', null)", [ids, till], "unknown allocation");
  });

  // ── 4. discounts are per company ───────────────────────────────────────────────────────────
  console.log("\nDiscounts — per company only:");
  await refuses("a bill discount on a two-company cart is refused",
    "select * from public.issue_checkout($1, null, null, $2, null)",
    [await draft(mixedLines(), { discount_kind: "percent", discount_value: 5 }), till], "cannot cover two companies");
  await step("each company's own discount", async () => {
    await c.query("savepoint d");
    const got = await checkout(await draft(mixedLines()), null, till, [{ legal_entity_id: tyreCo, discount_kind: "amount", discount_value: 460, discount_reason: "verify" }]);
    check("Rs 460 off the tyre bill only (VAT-inclusive)", `${got[0].total_incl} | ${got[1].total_incl}`, "4140.00 | 1300.00");
    await c.query("rollback to savepoint d");
  });
  await refuses("a discount naming a company with nothing on the sale",
    "select * from public.issue_checkout($1, null, null, $2, $3::jsonb)",
    [await draft([line(TYRE_PRODUCT, "Tyre", 2000)]), till, JSON.stringify([{ legal_entity_id: svc, discount_kind: "percent", discount_value: 5 }])], "nothing on this sale");
  await refuses("a company bill discounted to Rs 0 is refused before any number is drawn",
    "select * from public.issue_checkout($1, null, null, $2, $3::jsonb)",
    [await draft(mixedLines()), till, JSON.stringify([{ legal_entity_id: svc, discount_kind: "percent", discount_value: 100, discount_reason: "verify" }])], "Rs 0.00");
  await step("an owner's approval naming the service bill's id (known before the split)", async () => {
    await asAdmin();
    await c.query("update products set discount_policy = 'none' where id = $1", [SERVICE_PRODUCT]); // services: no discount without the owner
    const approver = (await one("select id from app_users where auth_user_id = $1 and tenant_id = $2", [SANDBOX_OWNER, SANDBOX])).id;
    await asOwner();
    const d = await draft(mixedLines());
    const svcId = (await one("select document_id from public.checkout_document_ids($1) where legal_entity_id = $2", [d, svc])).document_id;
    const tenOff = JSON.stringify([{ legal_entity_id: svc, discount_kind: "percent", discount_value: 10, discount_reason: "verify" }]);
    await refuses("  10% off the service bill without approval", "select * from public.issue_checkout($1, null, null, $2, $3::jsonb)", [d, till, tenOff], "discount exceeds allowance");
    await asAdmin();
    await c.query(`insert into owner_overrides (tenant_id, kind, ref_type, ref_id, scope, reason, approved_by)
                   values ($1, 'discount', 'document', $2, '{"max_discount_incl": 130}'::jsonb, 'verify', $3)`, [SANDBOX, svcId, approver]);
    await asOwner();
    const got = await checkout(d, null, till, JSON.parse(tenOff));
    check("  …with the owner's approval on that id it issues: service bill Rs 1,170", `${got[1].id === svcId} ${got[1].total_incl}`, "true 1170.00");
  });

  // ── 5. a job with both companies' work ─────────────────────────────────────────────────────
  console.log("\nA job billed by both companies:");
  let job, jobInv;
  await step("quote (one quote, both companies) → job → bill → issue", async () => {
    const qd = await draft(mixedLines(), { doc_type: "quote", vehicle_id: CAR });
    job = (await one("select id from public.convert_quote_to_job($1, $2, null, null)", [qd, TECH])).id;
    const bill = (await one("select id from public.create_document_from_job($1, 'invoice')", [job])).id;
    jobInv = await checkout(bill, "vtc:job1", till);
    check("one job, two bills", `${jobInv.length} ${jobInv.every((i) => i.job_id === job)}`, "2 true");
  });
  await step("paying the tyre bill alone does not hand the car back", async () => {
    await asAdmin();
    await c.query("update jobs set status = 'ready' where id = $1", [job]);
    await asOwner();
    await c.query("select public.record_payment($1, 'card', $2, null, 'VERIFY', $3, null, null)", [jobInv[0].id, jobInv[0].total_incl, till]);
    check("tyres paid, services still owed → job still ready", (await one("select status from jobs where id = $1", [job])).status, "ready");
    await refuses("  …and deliver_paid_job names the unpaid bill", "select public.deliver_paid_job($1)", [job], jobInv[1].number);
    await c.query("select public.record_payment($1, 'cash', $2, $2, null, $3, null, null)", [jobInv[1].id, jobInv[1].total_incl, till]);
    check("services paid too → the car is handed back", (await one("select status from jobs where id = $1", [job])).status, "delivered");
  });
  await step("cancelling a job resolves every bill", async () => {
    const qd = await draft(mixedLines(), { doc_type: "quote", vehicle_id: CAR });
    const j = (await one("select id from public.convert_quote_to_job($1, $2, null, null)", [qd, TECH])).id;
    const b = await checkout((await one("select id from public.create_document_from_job($1, 'invoice')", [j])).id, null, till);
    await c.query("select public.record_payment($1, 'card', $2, null, 'VERIFY', $3, null, null)", [b[1].id, b[1].total_incl, till]);
    const done = await one("select (public.cancel_job($1, 'verify', true, $2)).status", [j, till]);
    const st = await docs(b.map((x) => x.id));
    check("job cancelled; tyre bill voided, paid service bill credit-noted", `${done.status} ${st.map((s) => `${s.number}:${s.status}`).join(" ")}`,
      `cancelled ${[...b].sort((x, y) => x.number.localeCompare(y.number)).map((x) => `${x.number}:${x.id === b[0].id ? "void" : "paid"}`).join(" ")}`);
    const cn = await one("select number, legal_entity_id from documents where doc_type = 'credit_note' and source_document_id = $1", [b[1].id]);
    check("  …the credit note is in the service company's series", `${cn?.number} ${cn?.legal_entity_id === svc}`, "TESTWCN-0001 true");
  });

  // ── 6. quotes: one for both, or two ────────────────────────────────────────────────────────
  console.log("\nQuotes:");
  await refuses("one quote for both companies cannot carry a bill discount",
    "select public.issue_document($1, null, null, null)",
    [await draft(mixedLines(), { doc_type: "quote", discount_kind: "percent", discount_value: 5 })], "cannot cover two companies");
  await step("one quote for both: numbered in the default company's quote series", async () => {
    const qd = await draft(mixedLines(), { doc_type: "quote" });
    const want = await next(SANDBOX, "quote");
    check("one quote", (await one("select number from public.issue_document($1, null, null, null)", [qd])).number, want);
  });
  await step("two quotes: one per company, linked", async () => {
    const qd = await draft(mixedLines(), { doc_type: "quote" });
    const split = await q("select id, checkout_group_id, total_incl from public.split_document_by_company($1)", [qd]);
    const nums = [];
    for (const s of split) nums.push((await one("select number from public.issue_document($1, null, null, null)", [s.id])).number);
    check("two quotes in their own series, one group", `${nums[1]} ${split.every((s) => s.checkout_group_id === qd)} ${split.map((s) => s.total_incl).join("/")}`,
      "TESTWQ-00001 true 4600.00/1300.00");
  });

  // ── 7. reversing one checkout payment ──────────────────────────────────────────────────────
  console.log("\nReversal:");
  await step("reverse_checkout_payment walks back every part", async () => {
    const mirrors = await q("select amount from public.reverse_checkout_payment($1, 'verify', $2)", [g1.id, till]);
    check("two mirror payments", mirrors.map((m) => m.amount).sort().join(" "), "-1300.00 -4600.00");
    check("both bills open again", (await docs(inv.map((i) => i.id))).map((d) => d.status).join(" "), "issued issued");
  });

  // ── 8. a closed day still replays ──────────────────────────────────────────────────────────
  await step("a replay after the day is closed returns the sale", async () => {
    await asAdmin();
    await c.query("update trading_days set status = 'closed' where tenant_id = $1 and business_date = app.mu_today()", [SANDBOX]);
    await asOwner();
    check("replayed after close", (await checkout(d1, "vtc:sale1", till)).map((r) => r.number).join(" "), inv.map((r) => r.number).join(" "));
    await asAdmin();
    await c.query("update trading_days set status = 'open' where tenant_id = $1 and business_date = app.mu_today()", [SANDBOX]);
    await asOwner();
  });

  // ── 9. one company: today's sale, untouched ────────────────────────────────────────────────
  console.log("\nOne-company cart:");
  await step("issue_checkout with only tyres is today's single invoice", async () => {
    const want = await next(SANDBOX, "invoice");
    const k = await checkout(await draft([line(TYRE_PRODUCT, "Tyre", 2000)]), "vtc:one", till);
    check("one invoice, next number, no group", `${k.length} ${k[0].number} ${k[0].checkout_group_id}`, `1 ${want} null`);
    await asAdmin();
    const row = await one("select rpc from idempotency_keys where tenant_id = $1 and key = 'vtc:one'", [SANDBOX]);
    await asOwner();
    check("  …recorded under issue_document's own key (an old till's replay still works)", row?.rpc, "issue_document");
    const pg1 = await pay([k[0].id], "card", 2300, null, till, "proportional", null);
    check("  …and the checkout payment pays a single bill too", `${pg1.payment_ids.length} ${(await docs([k[0].id]))[0].status}`, "1 paid");
  });

  // ── 9b. one-company jobs through the spliced record_payment and cancel_job ────────────────
  console.log("\nOne-company jobs (Carfectionist's shape) through the changed payment and cancel code:");
  const tyreJob = async () => {
    const qd = await draft([line(TYRE_PRODUCT, "Tyre", 2000)], { doc_type: "quote", vehicle_id: CAR });
    return (await one("select id from public.convert_quote_to_job($1, $2, null, null)", [qd, TECH])).id;
  };
  const bill = async (j) => (await checkout((await one("select id from public.create_document_from_job($1, 'invoice')", [j])).id, null, till))[0];
  const money = async (j) => (await one(
    "select payload->>'money' m from audit_events where ref_type = 'job' and ref_id = $1 and event_type = 'job_cancelled'", [j])).m;
  await step("a ready job's single bill paid in full hands the car back", async () => {
    const j = await tyreJob();
    const b = await bill(j);
    check("  one bill, no group", `${b.checkout_group_id}`, "null");
    await asAdmin(); await c.query("update jobs set status = 'ready' where id = $1", [j]); await asOwner();
    await c.query("select public.record_payment($1, 'card', $2, null, 'VERIFY', $3, null, null)", [b.id, b.total_incl, till]);
    check("  delivered", (await one("select status from jobs where id = $1", [j])).status, "delivered");
  });
  await step("cancel a job whose bill is paid → credit note", async () => {
    const j = await tyreJob();
    const b = await bill(j);
    const cnNext = await next(SANDBOX, "credit_note");
    await c.query("select public.record_payment($1, 'card', $2, null, 'VERIFY', $3, null, null)", [b.id, b.total_incl, till]);
    await c.query("select public.cancel_job($1, 'verify', true, $2)", [j, till]);
    check("  credit note in the shop's own series", (await one("select number from documents where doc_type = 'credit_note' and source_document_id = $1", [b.id])).number, cnNext);
    check("  the job's record says what happened, as before", await money(j), `bill ${b.number} credit-noted, ${b.total_incl} refunded`);
  });
  await step("cancel a job whose bill is unpaid → bill voided", async () => {
    const j = await tyreJob();
    const b = await bill(j);
    await c.query("select public.cancel_job($1, 'verify', true, $2)", [j, till]);
    check("  voided", (await docs([b.id]))[0].status, "void");
    check("  record", await money(j), `bill ${b.number} voided`);
  });
  await step("cancel a job whose bill is still a draft → draft deleted", async () => {
    const j = await tyreJob();
    const d = (await one("select id from public.create_document_from_job($1, 'invoice')", [j])).id;
    await c.query("select public.cancel_job($1, 'verify', true, $2)", [j, till]);
    check("  deleted", (await q("select 1 from documents where id = $1", [d])).length, 0);
    check("  record", await money(j), "draft deleted");
  });
  await step("cancel a job with no bill", async () => {
    const j = await tyreJob();
    await c.query("select public.cancel_job($1, 'verify', true, $2)", [j, till]);
    check("  record", await money(j), "no invoice");
  });
  await step("one bill for two cars, paid in full, hands both cars back", async () => {
    const owner = "73682d6d-8adb-4e3f-acaf-90c3a1b9928f";
    const cars = (await q("select id from vehicles where customer_id = $1 order by plate limit 2", [owner])).map((v) => v.id);
    const qd = await draft(cars.map((v, i) => line(TYRE_PRODUCT, `Tyre car ${i + 1}`, 2000, { vehicle_id: v, sort_order: i })),
      { doc_type: "quote", customer_id: owner });
    await c.query("select * from public.convert_quote_to_jobs($1, null, null, null)", [qd]);
    await asAdmin(); await c.query("update jobs set status = 'ready', ready_at = now() where source_quote_id = $1", [qd]); await asOwner();
    const inv2 = (await one("select id from public.convert_quote_to_invoice($1)", [qd])).id;
    const b = (await checkout(inv2, null, till))[0];
    await c.query("select public.record_payment($1, 'card', $2, null, 'VERIFY', $3, null, null)", [b.id, b.total_incl, till]);
    check("  both cars delivered", (await q("select status from jobs where source_quote_id = $1 order by id", [qd])).map((r) => r.status).join(" "), "delivered delivered");
  });

  // ── 10. the live shop, read-only ───────────────────────────────────────────────────────────
  await asAdmin();
  console.log("\nCarfectionist (live shop), read-only:");
  const liveAfter = await one(
    `select quote_prefix||quote_next_number q, invoice_prefix||invoice_next_number i, credit_note_prefix||credit_note_next_number cn
       from legal_entities where tenant_id = $1 and is_default`, [LIVE]);
  check("next quote / invoice / credit note unchanged", JSON.stringify(liveAfter), JSON.stringify(liveBefore));
  check("one company", (await one("select count(*) n from legal_entities where tenant_id = $1", [LIVE])).n, 1);
  check("no live-shop document in a checkout group", (await one("select count(*) n from documents where tenant_id = $1 and checkout_group_id is not null", [LIVE])).n, 0);
  const billSeqAfter = (await one("select last_value from documents_bill_no_seq")).last_value;
  console.log(`  (bill numbers drawn by this run's sandbox documents, not returned on rollback: ${Number(billSeqAfter) - Number(billSeqBefore)})`);
} catch (e) {
  failures++;
  console.log(`✗ stopped: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
  console.log(`\n${failures === 0 ? "ALL GOOD" : `${failures} FAILURE(S)`} — rolled back, nothing kept`);
  process.exitCode = failures === 0 ? 0 : 1;
}
