// Rolled-back verification for the loyalty programme's off switch (20260811000090).
//
// OFF must mean off in both directions — a settled bill earns nothing, and points
// cannot be spent — while a REVERSAL still refunds points taken while it was on.
// That last one is the whole reason the guard is not on unwind_points_for_payment:
// switching the scheme off must never strand a customer's redemption.
//
// Runs as `authenticated` impersonating the sandbox owner, then ROLLS BACK.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const TENANT = "22222222-2222-4222-8222-000000000002"; // Carfectionist Sandbox

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");

  const owner = (await c.query(
    "select auth_user_id from public.app_users where tenant_id = $1 and role = 'owner' limit 1", [TENANT],
  )).rows[0].auth_user_id;
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: owner, role: "authenticated" }),
  ]);

  console.log("▸ the column exists and defaults to ON");
  const dflt = (await c.query(
    `select column_default from information_schema.columns
      where table_schema='public' and table_name='business_settings' and column_name='points_enabled'`,
  )).rows[0]?.column_default ?? "";
  check("business_settings.points_enabled defaults true", dflt.startsWith("true"), true);

  // A bill to work with: an issued, unpaid invoice for a named customer.
  const customer = (await c.query(
    "select id, points_balance from public.customers where tenant_id = $1 order by created_at limit 1", [TENANT],
  )).rows[0];
  const till = (await c.query(
    "select id from public.cash_sessions where tenant_id = $1 and closed_at is null order by opened_at desc limit 1",
    [TENANT],
  )).rows[0];
  const shop = (await c.query(
    "select id from public.stock_locations where tenant_id = $1 limit 1", [TENANT],
  )).rows[0];

  const newBill = async (key) => {
    const doc = {
      id: null, doc_type: "invoice", customer_id: customer.id, vehicle_id: null, template_id: null,
      template_overrides: {}, valid_until: null, due_date: null, origin: "standalone",
      discount_kind: null, discount_value: 0,
    };
    const saved = (await c.query("select * from public.save_draft($1::jsonb, $2::jsonb, null)", [
      JSON.stringify(doc),
      JSON.stringify([{ product_id: null, title: "probe labour", qty: 1, unit_price: 1000,
        discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15, sort_order: 0 }]),
    ])).rows[0];
    await c.query(
      `select public.issue_document(p_document_id => $1::uuid, p_stock_location_id => $2::uuid,
         p_idempotency_key => $3::text, p_session_id => $4::uuid)`, [saved.id, shop.id, key, till.id],
    );
    return saved.id;
  };
  const balance = async () =>
    Number((await c.query("select points_balance from public.customers where id = $1", [customer.id])).rows[0].points_balance);
  const pay = async (doc, method, amount, key) =>
    (await c.query(
      `select * from public.record_payment(p_invoice_id => $1::uuid, p_method => $2::payment_method,
         p_amount => $3::numeric, p_tendered => null, p_external_ref => null,
         p_cash_session_id => $4::uuid, p_idempotency_key => $5::text)`,
      [doc, method, amount, till.id, key],
    )).rows[0];
  const setSwitch = (on) =>
    c.query("update public.business_settings set points_enabled = $1 where id = $2", [on, TENANT]);

  console.log("\n▸ switched ON, nothing changes");
  await setSwitch(true);
  const before = await balance();
  const billA = await newBill("probe:on");
  await pay(billA, "cash", 1150, "probe:on:pay");
  check("a Rs 1,150 bill earns 11 points", (await balance()) - before, 11);

  console.log("\n▸ switched OFF, a settled bill earns nothing");
  await setSwitch(false);
  const afterOn = await balance();
  const billB = await newBill("probe:off");
  await pay(billB, "cash", 1150, "probe:off:pay");
  check("the balance does not move", await balance(), afterOn);

  console.log("\n▸ switched OFF, points cannot be spent");
  const billC = await newBill("probe:off2");
  let refusal = "none";
  try {
    await c.query("savepoint s1");
    await pay(billC, "points", 5, "probe:off:pts");
  } catch (e) { refusal = e.message; }
  await c.query("rollback to savepoint s1");
  check("spending is refused", refusal, "points are switched off");
  check("and the balance is untouched", await balance(), afterOn);

  console.log("\n▸ a reversal still refunds points taken while it was ON");
  await setSwitch(true);
  const billD = await newBill("probe:refund");
  const spent = await pay(billD, "points", 5, "probe:refund:pts");
  const afterSpend = await balance();
  check("5 points' worth comes off the balance", afterOn - afterSpend, 5);

  // The owner switches the scheme off BEFORE the payment is reversed — the case the
  // guard on unwind would have broken.
  await setSwitch(false);
  await c.query("select public.reverse_payment($1::uuid, $2::text)", [spent.id, "probe reversal"]);
  check("the points come back even though the scheme is now off", await balance(), afterOn);

  console.log(`\n${failures === 0 ? "ALL GOOD" : `${failures} FAILURE(S)`} — nothing persisted (rolled back)`);
} catch (e) {
  failures++;
  console.error("✗ probe blew up:", e.message);
} finally {
  await c.query("rollback");
  await c.end();
}
process.exitCode = failures === 0 ? 0 : 1;
