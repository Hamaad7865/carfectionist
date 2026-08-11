// Rolled-back verification for the owner-editable POS rules (20260812000010).
//
// Proves the carwash cap and per-kind defaults now come from business_settings,
// that the DEFAULT (5 / none / free) reproduces the previous hardcoded numbers
// byte-for-byte, that changing them moves the allowance, and that the reversal
// toggle refuses a manager's approved override when strict.
//
// Runs as the sandbox owner, then ROLLS BACK.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const TENANT = "22222222-2222-4222-8222-000000000002";
const OWNER_AUTH = "b729191b-1159-4d46-88c7-3c9aceb5e664";

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

// Round half away from zero to 2dp — matches Postgres numeric round() for positives.
const r2 = (x) => Math.round(x * 100) / 100;
// The exact gross_incl / net-at-pct arithmetic the SQL uses.
const grossIncl = (qty, unit, vat) => r2(qty * unit) + r2((r2(qty * unit) * vat) / 100);
const netAtPct = (qty, unit, vat, pct) => {
  const excl = r2(qty * unit * (1 - pct / 100));
  return excl + r2((excl * vat) / 100);
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" }),
  ]);

  console.log("▸ the columns exist with behaviour-preserving defaults");
  const defs = (await c.query(
    `select column_name, column_default from information_schema.columns
      where table_schema='public' and table_name='business_settings'
        and column_name in ('discount_carwash_pct','default_policy_service','default_policy_goods','reversal_requires_owner')
      order by column_name`,
  )).rows;
  const byName = Object.fromEntries(defs.map((d) => [d.column_name, d.column_default]));
  check("discount_carwash_pct defaults 5", (byName.discount_carwash_pct ?? "").startsWith("5"), true);
  check("default_policy_service defaults none", (byName.default_policy_service ?? "").startsWith("'none'"), true);
  check("default_policy_goods defaults free", (byName.default_policy_goods ?? "").startsWith("'free'"), true);
  check("reversal_requires_owner defaults false", byName.reversal_requires_owner, "false");

  // A carwash product priced at 1000 net, VAT 15, qty 1.
  const prod = (await c.query(
    `insert into public.products (tenant_id, name, kind, discount_policy, selling_price, vat_rate)
     values ($1,'PROBE carwash','service','carwash',1000,15) returning id`, [TENANT],
  )).rows[0].id;
  const customer = (await c.query(
    "select id from public.customers where tenant_id=$1 order by created_at limit 1", [TENANT],
  )).rows[0].id;
  const doc = {
    id: null, doc_type: "quote", customer_id: customer, vehicle_id: null, template_id: null,
    template_overrides: {}, valid_until: null, due_date: null, origin: "standalone",
    discount_kind: null, discount_value: 0,
  };
  const docId = (await c.query("select * from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify(doc),
    JSON.stringify([{ product_id: prod, title: "PROBE carwash", qty: 1, unit_price: 1000,
      discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15, sort_order: 0 }]),
  ])).rows[0].id;

  // The stored line values the SQL will actually read.
  const line = (await c.query(
    "select qty::numeric, unit_price::numeric, vat_rate::numeric from public.document_lines where document_id=$1", [docId],
  )).rows[0];
  const qty = Number(line.qty), unit = Number(line.unit_price), vat = Number(line.vat_rate);

  const limits = async () =>
    (await c.query("select * from app.document_discount_limits($1)", [docId])).rows[0];

  console.log("▸ the default cap of 5 reproduces the old numbers exactly");
  const want5 = r2(grossIncl(qty, unit, vat) - netAtPct(qty, unit, vat, 5));
  const at5 = await limits();
  check("ceiling at cap 5", Number(at5.ceiling_incl), want5);

  console.log("▸ raising the cap to 10 moves the ceiling");
  await c.query("update public.business_settings set discount_carwash_pct = 10 where id = $1", [TENANT]);
  const want10 = r2(grossIncl(qty, unit, vat) - netAtPct(qty, unit, vat, 10));
  const at10 = await limits();
  check("ceiling at cap 10", Number(at10.ceiling_incl), want10);
  check("cap 10 is larger than cap 5", want10 > want5, true);

  console.log("▸ a per-kind default flips a service from none to free");
  await c.query("update public.business_settings set discount_carwash_pct = 5 where id = $1", [TENANT]);
  // Same product, but now mark it inherit so the per-kind default decides.
  await c.query("update public.products set discount_policy = 'inherit' where id = $1", [prod]);
  const svcNone = await limits(); // service default = none → 0 ceiling, 0 free
  check("inherit service, default none: free is 0", Number(svcNone.free_incl), 0);
  await c.query("update public.business_settings set default_policy_service = 'free' where id = $1", [TENANT]);
  const svcFree = await limits(); // now service default = free → full gross is free
  check("inherit service, default free: free is full gross", Number(svcFree.free_incl), grossIncl(qty, unit, vat));

  console.log("▸ the reversal toggle refuses a manager's override when strict");
  // Set up as the connecting superuser (RLS bypassed for inserts); the reversal
  // helper reads its role from the JWT claim, not the DB role, so a manager JWT
  // over a postgres session still exercises the non-owner path exactly.
  await c.query("reset role");
  await c.query("update public.business_settings set discount_carwash_pct = 5, default_policy_service = 'none' where id = $1", [TENANT]);
  // A genuine login: app_users.auth_user_id has a FK to auth.users. auth.users
  // needs only an id, so a minimal row gives us a real manager to test as. All
  // rolled back at the end.
  const mgrAuth = (await c.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
  await c.query(
    `insert into public.app_users (tenant_id, auth_user_id, role, display_name)
     values ($1,$2,'manager','PROBE mgr')`, [TENANT, mgrAuth],
  );
  const payId = (await c.query("select gen_random_uuid() u")).rows[0].u;
  // approved_by references app_users.id, not the auth uid.
  const ownerAppUser = (await c.query(
    "select id from public.app_users where tenant_id=$1 and role='owner' order by created_at limit 1", [TENANT],
  )).rows[0].id;
  await c.query(
    `insert into public.owner_overrides (tenant_id, kind, ref_type, ref_id, reason, approved_by)
     values ($1,'reversal','payment',$2,'probe',$3)`, [TENANT, payId, ownerAppUser],
  );

  const asManager = () => c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: mgrAuth, role: "authenticated" }),
  ]);
  const callGate = async () => {
    try { await c.query("select app.require_owner_or_override('payment', $1)", [payId]); return "passed"; }
    catch (e) { return e.message.includes("requires the owner") ? "refused" : `other: ${e.message}`; }
  };

  await asManager();
  await c.query("savepoint s");
  const lenient = await callGate();
  await c.query("rollback to savepoint s");
  check("strict OFF: manager with override passes", lenient, "passed");

  await c.query("update public.business_settings set reversal_requires_owner = true where id = $1", [TENANT]);
  await asManager();
  await c.query("savepoint s2");
  const strict = await callGate();
  await c.query("rollback to savepoint s2");
  check("strict ON: manager with override refused", strict, "refused");

  console.log(`\n${failures === 0 ? "ALL GOOD" : `${failures} FAILURE(S)`} — nothing persisted (rolled back)`);
} catch (e) {
  failures++;
  console.error("✗ probe blew up:", e.message);
} finally {
  await c.query("rollback");
  await c.end();
}
process.exitCode = failures === 0 ? 0 : 1;
