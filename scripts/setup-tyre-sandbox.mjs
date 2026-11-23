// Create (or repair) the TYRE CENTRE SANDBOX — a TEST tenant shaped like the real tyre centre
// (Garage De L'Est, 1f060b86…): one login, two issuing companies inside it.
//
//   node scripts/setup-tyre-sandbox.mjs
//
// · TEST Tyres Ltd          — the default company, VAT-registered 15%, TTQ- / TTINV- / TTCN-
// · TEST Tyre Services      — not VAT-registered,                      TSQ- / TSINV- / TSCN-
//
// A quote holding a tyre and an alignment therefore issues as TWO quotes (one per company).
//
// Being a tyre shop (no WhatsApp, short intake, tyre checklist, Tyre Centre POS roster) is NOT
// data: the tenant id below must also be in TYRE_TENANTS (apps/web/src/lib/auth/roles.ts),
// TenantFeatures.kt, and the tyrecentre flavor's POS_TENANTS (android/app/build.gradle.kts).
//
// Safe to re-run: every write is upsert-shaped. The owner's password and PIN are generated on
// the first run and printed ONCE — they are never stored in this file. A re-run leaves them alone.
import pg from "pg";
import { randomBytes, randomInt } from "node:crypto";
import { DB_URL, SUPABASE_URL, SERVICE_ROLE_KEY, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
requireEnv("SUPABASE_URL", SUPABASE_URL);
requireEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

export const TYRE_SANDBOX_TENANT = "44444444-4444-4444-8444-000000000004";
const EMAIL = "tyrecenter@test.com";
const DISPLAY = "TEST Tyre Owner";
const SEND_TO = "boodoo.sheik786@gmail.com"; // every outgoing email/send is redirected here

const TYRE_CO = {
  legal_name: "TEST Tyres Ltd — NOT A REAL COMPANY",
  trading_name: "Tyre Centre Sandbox (TEST)",
  prefixes: ["TTQ-", "TTINV-", "TTCN-"],
};
const SERVICE_CO = {
  legal_name: "TEST Tyre Services — NOT A REAL COMPANY",
  trading_name: "TEST Tyre Services",
  prefixes: ["TSQ-", "TSINV-", "TSCN-"],
};

// Prices are VAT-exclusive (prices_vat_exclusive, price_includes_vat = false), like the real shop.
const TYRES = [
  ["TEST Tyre 175/65 R14", 2600],
  ["TEST Tyre 185/65 R15", 3000],
  ["TEST Tyre 195/65 R15", 3400],
  ["TEST Tyre 205/55 R16", 3900],
];
const SERVICES = [
  ["Wheel alignment", 800],
  ["Tyre fitting (per tyre)", 150],
  ["Wheel balancing (per wheel)", 200],
];

const H = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
const admin = (path, opts = {}) => fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, { ...opts, headers: H });

const T = TYRE_SANDBOX_TENANT;
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

try {
  await c.query("begin");

  // ── the shop + its default company ───────────────────────────────────────
  // No BRN or VAT number (a TEST company must never look fiscal). Inserting business_settings
  // makes its default legal_entities row (trigger default_entity_for_new_tenant) from these
  // fields, prefixes included.
  const [tq, ti, tc] = TYRE_CO.prefixes;
  await c.query(
    `insert into public.business_settings
       (id, legal_name, trading_name, country, vat_rate, prices_vat_exclusive,
        quote_prefix, quote_next_number, invoice_prefix, invoice_next_number,
        credit_note_prefix, credit_note_next_number, z_next_number,
        is_sandbox, sandbox_send_to)
     values ($1, $2, $3, 'MU', 15, true, $4, 1, $5, 1, $6, 1, 1, true, $7)
     on conflict (id) do update set is_sandbox = true, sandbox_send_to = excluded.sandbox_send_to`,
    [T, TYRE_CO.legal_name, TYRE_CO.trading_name, tq, ti, tc, SEND_TO],
  );
  const tyreCo = (await c.query(
    "select id from public.legal_entities where tenant_id = $1 and is_default", [T],
  )).rows[0]?.id;
  if (!tyreCo) throw new Error("the default company was not created");
  console.log(`▸ shop: ${TYRE_CO.trading_name} — sends redirected to ${SEND_TO}`);
  console.log(`▸ company 1: ${TYRE_CO.legal_name} (VAT 15%, ${TYRE_CO.prefixes.join(" ")})`);

  // ── the non-VAT service company ──────────────────────────────────────────
  const [sq, si, sc] = SERVICE_CO.prefixes;
  let serviceCo = (await c.query(
    "select id from public.legal_entities where tenant_id = $1 and quote_prefix = $2", [T, sq],
  )).rows[0]?.id;
  if (!serviceCo) {
    serviceCo = (await c.query(
      `insert into public.legal_entities
         (tenant_id, legal_name, trading_name, vat_registered, vat_rate,
          quote_prefix, invoice_prefix, credit_note_prefix, is_default, sort_order)
       values ($1, $2, $3, false, 0, $4, $5, $6, false, 1)
       returning id`,
      [T, SERVICE_CO.legal_name, SERVICE_CO.trading_name, sq, si, sc],
    )).rows[0].id;
  }
  console.log(`▸ company 2: ${SERVICE_CO.legal_name} (no VAT, ${SERVICE_CO.prefixes.join(" ")})`);

  // ── where stock lives ────────────────────────────────────────────────────
  const hasLoc = (await c.query("select 1 from public.stock_locations where tenant_id = $1", [T])).rowCount;
  if (!hasLoc) {
    await c.query(
      `insert into public.stock_locations (tenant_id, name, is_default, is_sales_floor) values ($1, 'Shop', true, true)`,
      [T],
    );
  }
  console.log("▸ stock location: Shop");

  // ── the catalogue ────────────────────────────────────────────────────────
  // Tyres are not stock-tracked to start (like the real shop's first product), so a sale never
  // trips on an empty shelf; receive stock through a purchase order to try stock.
  const upsertProduct = async (name, price, kind, unit, category, company) => {
    const found = (await c.query("select id from public.products where tenant_id = $1 and name = $2", [T, name])).rows[0];
    if (found) return false;
    // vat_rate null = the tenant default (15%); the non-VAT company's trigger forces 0.
    await c.query(
      `insert into public.products (tenant_id, name, kind, unit, selling_price, vat_rate, is_stocked, category, legal_entity_id, price_includes_vat)
       values ($1, $2, $3, $4, $5, null, false, $6, $7, false)`,
      [T, name, kind, unit, price, category, company],
    );
    return true;
  };
  let added = 0;
  for (const [name, price] of TYRES) added += (await upsertProduct(name, price, "product", "piece", "Tyres", tyreCo)) ? 1 : 0;
  for (const [name, price] of SERVICES) added += (await upsertProduct(name, price, "service", "service", "Services", serviceCo)) ? 1 : 0;
  console.log(`▸ catalogue: ${added} added (${TYRES.length} tyres → company 1, ${SERVICES.length} services → company 2)`);

  // ── customers ────────────────────────────────────────────────────────────
  // The tablet bills anonymous sales to a customer row named exactly "Walk-in customer".
  if (!(await c.query("select 1 from public.customers where tenant_id = $1 and name = 'Walk-in customer'", [T])).rowCount) {
    await c.query("insert into public.customers (tenant_id, name) values ($1, 'Walk-in customer')", [T]);
  }
  let cust = (await c.query("select id from public.customers where tenant_id = $1 and name = 'Test Tyre Customer'", [T])).rows[0]?.id;
  if (!cust) {
    cust = (await c.query(
      "insert into public.customers (tenant_id, name, phone, email) values ($1, 'Test Tyre Customer', '58811004', $2) returning id",
      [T, SEND_TO],
    )).rows[0].id;
    await c.query(
      "insert into public.vehicles (tenant_id, customer_id, plate, make, model) values ($1, $2, 'TEST 2', 'Toyota', 'Test Car')",
      [T, cust],
    );
  }
  console.log("▸ customers: Walk-in customer, Test Tyre Customer (TEST 2)");

  await c.query("commit");
} catch (e) {
  await c.query("rollback");
  console.error("✗ failed, nothing written:", e.message);
  await c.end();
  process.exit(1);
}

// ── the login ───────────────────────────────────────────────────────────────
// Outside the transaction: the auth user lives in GoTrue, not in our schema.
const found = await (await admin(`/users?filter=${encodeURIComponent(EMAIL)}`)).json().catch(() => null);
let authId = found?.users?.find((u) => u.email === EMAIL)?.id ?? null;
let password = null;
if (!authId) {
  password = randomBytes(12).toString("base64url");
  const made = await (await admin("/users", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password, email_confirm: true, user_metadata: { display_name: DISPLAY, role: "owner" } }),
  })).json();
  authId = made?.id ?? null;
  if (!authId) { console.error("✗ could not create the auth user:", JSON.stringify(made)); await c.end(); process.exit(1); }
}

const existing = (await c.query(
  "select id from public.app_users where tenant_id = $1 and auth_user_id = $2", [T, authId],
)).rows[0];
let pin = null;
if (!existing) {
  pin = String(randomInt(1000, 10000));
  const u = (await c.query(
    `insert into public.app_users (tenant_id, auth_user_id, display_name, role, is_active)
     values ($1, $2, $3, 'owner', true) returning id`, [T, authId, DISPLAY],
  )).rows[0];
  await c.query(
    "update public.app_users set pin_hash = extensions.crypt($2, extensions.gen_salt('bf')), pin_set_at = now() where id = $1",
    [u.id, pin],
  );
  console.log(`▸ owner: ${DISPLAY} (app_user ${u.id})`);
} else {
  console.log(`▸ owner: ${DISPLAY} already exists (app_user ${existing.id}) — PIN unchanged`);
}
await c.end();

console.log(`\n  tenant   ${T}\n  web      ${EMAIL}${password ? `  /  ${password}   ← shown once` : "  (password unchanged)"}`);
if (pin) console.log(`  PIN      ${pin}   ← shown once`);
