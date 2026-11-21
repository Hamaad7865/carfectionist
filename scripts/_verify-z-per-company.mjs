// Applies 20261123000020_z_totals_per_company.sql inside ONE transaction on the live database,
// proves the per-company Z on the TEST Sandbox (a second, non-VAT company is created for the run),
// checks a one-company shop's Z is byte-identical, then ROLLS BACK. Nothing is kept.
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-z-per-company.mjs
import fs from "node:fs";
import pg from "pg";

const SANDBOX = "22222222-2222-4222-8222-000000000002";
const SANDBOX_OWNER = "b729191b-1159-4d46-88c7-3c9aceb5e664";
const TYRE_PRODUCT = "87530748-1b27-459a-9f20-ec7cf3e28e7f";
const SERVICE_PRODUCT = "948e53f4-54ba-4f11-80c1-7059b3735604";
const CAR_OWNER = "3668d8c3-75cc-402e-8fa5-143460857959";
const LIVE = "11111111-1111-4111-8111-000000000001";
const sql = fs.readFileSync("supabase/migrations/20261123000020_z_totals_per_company.sql", "utf8");

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
const draft = async (lines) => {
  const d = { id: null, doc_type: "invoice", customer_id: CAR_OWNER, vehicle_id: null, template_id: null, template_overrides: {},
    valid_until: null, due_date: null, origin: "standalone", discount_kind: null, discount_value: 0, discount_reason: null };
  return (await one("select (public.save_draft($1::jsonb, $2::jsonb, null)).id", [JSON.stringify(d), JSON.stringify(lines)])).id;
};
const z = async (tenant, session, day, asAt) =>
  (await one("select app.z_totals($1, $2, $3, $4) z", [tenant, session, day, asAt])).z;
const n2 = (x) => Number(x ?? NaN).toFixed(2);
// close_period as the sandbox owner, inside a savepoint (it inserts a period_closes row).
const closeMonth = async (month) => {
  await c.query("savepoint pc");
  await asOwner();
  const r = (await one("select (public.close_period($1)).totals t", [month])).t;
  await asAdmin();
  await c.query("rollback to savepoint pc");
  return r;
};
const methods = (ms) => JSON.stringify((ms ?? []).map((m) => `${m.method} ${Number(m.net).toFixed(2)}`));

try {
  await c.query("begin");
  await c.query("set local lock_timeout = '5s'");
  const asAt = (await one("select now() t")).t;

  // One-company shops BEFORE the migration: the live shop's latest service and day, and the
  // sandbox (still one company here).
  const liveSess = await one("select id, trading_day_id from cash_sessions where tenant_id = $1 order by opened_at desc limit 1", [LIVE]);
  const sbSess = await one("select id, trading_day_id from cash_sessions where tenant_id = $1 order by opened_at desc limit 1", [SANDBOX]);
  const month = (await one(
    `select to_char(max(issued_at at time zone 'Indian/Mauritius'), 'YYYY-MM') m from documents
      where tenant_id = $1 and doc_type = 'invoice' and issued_at < date_trunc('month', now() at time zone 'Indian/Mauritius')`, [SANDBOX])).m;
  const closedMonth = await one("select 1 from period_closes where tenant_id = $1 and period = $2", [SANDBOX, month]);
  if (closedMonth) await c.query("delete from period_closes where tenant_id = $1 and period = $2", [SANDBOX, month]); // rolled back
  const before = {
    month: await closeMonth(month),
    liveS: await z(LIVE, liveSess.id, null, asAt),
    liveD: await z(LIVE, null, liveSess.trading_day_id, asAt),
    sbS: await z(SANDBOX, sbSess.id, null, asAt),
  };

  await c.query(sql);
  console.log("✓ migration applied");
  await c.query(sql);
  console.log("✓ applied twice (the splice is idempotent)");
  check("one function definition", (await one(
    "select count(*) n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'z_totals'")).n, 1);

  console.log("\nOne-company shops — the Z is unchanged:");
  const liveS = await z(LIVE, liveSess.id, null, asAt);
  check("Carfectionist's latest service Z, identical", JSON.stringify(liveS) === JSON.stringify(before.liveS), true);
  check("Carfectionist's latest day Z, identical", JSON.stringify(await z(LIVE, null, liveSess.trading_day_id, asAt)) === JSON.stringify(before.liveD), true);
  check("…no 'companies' section", "companies" in liveS, false);
  check("the sandbox (one company still), identical", JSON.stringify(await z(SANDBOX, sbSess.id, null, asAt)) === JSON.stringify(before.sbS), true);
  check(`the sandbox's ${month} month close (one company), identical`, JSON.stringify(await closeMonth(month)) === JSON.stringify(before.month), true);

  // ── the sandbox becomes a two-company shop ─────────────────────────────────────────────────
  const svc = (await one(
    `insert into legal_entities (tenant_id, legal_name, trading_name, brn, vat_registered, vat_number, vat_rate, quote_prefix, invoice_prefix, credit_note_prefix, sort_order)
     values ($1, 'TEST Wheel Services Ltd', 'TEST Wheel Services', 'C99999999', false, null, 0, 'TESTWQ-', 'TESTWS-', 'TESTWCN-', 1) returning id`, [SANDBOX])).id;
  const tyreCo = (await one("select id from legal_entities where tenant_id = $1 and is_default", [SANDBOX])).id;
  await c.query("update products set legal_entity_id = $1 where id = $2", [svc, SERVICE_PRODUCT]);
  await c.query("update trading_days set status = 'open' where tenant_id = $1 and business_date = app.mu_today() and status = 'closed'", [SANDBOX]);
  await c.query("update cash_sessions set status = 'closed', closed_at = now() where tenant_id = $1 and status = 'open'", [SANDBOX]);
  await asOwner();
  const till = (await one("select (public.back_office_till()).id")).id;

  // Sale 1: 2 tyres (4,600 incl) + alignment (1,300, no VAT), one cash payment.
  const d1 = await draft([line(TYRE_PRODUCT, "Tyre 205/55R16", 2000, { qty: 2 }), line(SERVICE_PRODUCT, "Wheel alignment", 1300, { sort_order: 1 })]);
  const inv1 = await q("select id from public.issue_checkout($1, null, 'vz:s1', $2, null)", [d1, till]);
  await one("select * from public.record_checkout_payment($1::uuid[], 'cash', 5900, 6000, null, $2, 'proportional', 'vz:p1')", [inv1.map((i) => i.id), till]);
  // Sale 2: one tyre only (2,300), by card — a one-company draft goes through issue_document.
  const d2 = await draft([line(TYRE_PRODUCT, "Tyre 205/55R16", 2000)]);
  const inv2 = await q("select id from public.issue_checkout($1, null, 'vz:s2', $2, null)", [d2, till]);
  await one("select * from public.record_checkout_payment($1::uuid[], 'card', 2300, null, 'VERIFY', $2, 'proportional', 'vz:p2')", [inv2.map((i) => i.id), till]);
  // Sale 3: a service only (1,300), left owing.
  const d3 = await draft([line(SERVICE_PRODUCT, "Balancing", 1300)]);
  await q("select id from public.issue_checkout($1, null, 'vz:s3', $2, null)", [d3, till]);
  await asAdmin();

  const zt = await z(SANDBOX, till, null, (await one("select clock_timestamp() + interval '1 second' t")).t);
  console.log("\nTwo-company shop — the Z by company:");
  check("combined: 4 tickets, Rs 9,500", `${zt.tickets} ${n2(zt.total_incl)}`, "4 9500.00");
  check("two companies, tyres first", (zt.companies ?? []).map((x) => (x.id === tyreCo ? "tyre" : x.id === svc ? "svc" : "?")).join(" "), "tyre svc");
  const [t = {}, s = {}] = zt.companies ?? [];
  check("tyre company: 2 tickets, Rs 6,900 incl, 6,000 excl, 900 VAT", `${t.tickets} ${n2(t.total_incl)} ${n2(t.excl)} ${n2(t.vat)}`, "2 6900.00 6000.00 900.00");
  check("  …VAT-registered", t.vat_registered, true);
  check("  …money: card 2,300 + cash 4,600", methods(t.methods), JSON.stringify(["card 2300.00", "cash 4600.00"]));
  check("service company: 2 tickets, Rs 2,600, no VAT", `${s.tickets} ${n2(s.total_incl)} ${n2(s.excl)} ${n2(s.vat)}`, "2 2600.00 2600.00 0.00");
  check("  …not VAT-registered, named by its trading name", `${s.vat_registered} ${s.name}`, "false TEST Wheel Services");
  check("  …money: cash 1,300 (the balancing is still owed)", methods(s.methods), JSON.stringify(["cash 1300.00"]));
  check("companies add up to the combined sales", n2(Number(t.total_incl) + Number(s.total_incl)), n2(zt.total_incl));
  const combinedNet = zt.methods.reduce((a, m) => a + Number(m.net), 0);
  const perCoNet = (zt.companies ?? []).flatMap((x) => x.methods).reduce((a, m) => a + Number(m.net), 0);
  check("companies add up to the combined money", perCoNet.toFixed(2), combinedNet.toFixed(2));

  console.log(`
Two-company shop — the ${month} month close by company:`);
  const mc = await closeMonth(month);
  check("combined figures unchanged by the second company", JSON.stringify({ ...mc, companies: undefined }), JSON.stringify(before.month));
  const [mt = {}, ms = {}] = mc.companies ?? [];
  check("two companies, tyres first", `${mt.id === tyreCo} ${ms.id === svc}`, "true true");
  check("history (no company stored) is the default company's", `${mt.invoices?.count} ${n2(mt.invoices?.revenue)}`, `${mc.invoices.count} ${n2(mc.invoices.revenue)}`);
  check("  …the new company had nothing that month", `${ms.invoices?.count} ${n2(ms.invoices?.revenue)}`, "0 0.00");
  const sumObj = (o) => Object.values(o ?? {}).reduce((a, v) => a + Number(v), 0);
  check("company money adds up to the month's money", n2(sumObj(mt.payments_by_method) + sumObj(ms.payments_by_method)), n2(sumObj(mc.payments_by_method)));
} catch (e) {
  failures++;
  console.log(`✗ aborted: ${e.message}`);
} finally {
  await c.query("rollback");
  await c.end();
  console.log(failures ? `\n${failures} FAILED` : "\nALL GOOD (rolled back — nothing kept)");
  process.exitCode = failures ? 1 : 0;
}
