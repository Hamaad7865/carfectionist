// Create (or repair) the SANDBOX tenant — somewhere to rehearse that can be wiped.
//
//   node scripts/setup-sandbox.mjs [--send-to you@example.com]
//
// Why a second tenant rather than a second database: every table that matters
// carries tenant_id, numbering is issued per tenant, and app.current_tenant_id()
// reads the tenant off whoever is signed in. So the sandbox needs no build flag
// and no separate deployment — you switch by signing in with its PIN, and switch
// back by signing in as yourself. Migrations apply once, so it can never drift
// from production the way a copied database would.
//
// Safe to re-run: everything here is upsert-shaped.
import pg from "pg";
import { randomInt } from "node:crypto";
import { DB_URL, SUPABASE_URL, SERVICE_ROLE_KEY, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
requireEnv("SUPABASE_URL", SUPABASE_URL);
requireEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

import { SANDBOX_TENANT } from "./_sandbox.mjs";
export { SANDBOX_TENANT };
const EMAIL = "sandbox@carfectionist.mu";
const PASSWORD = "Sandbox#2026";
const DISPLAY = "TEST Sandbox";

const argSendTo = (() => {
  const i = process.argv.indexOf("--send-to");
  return i > -1 ? process.argv[i + 1] : null;
})();

const H = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
const admin = (path, opts = {}) => fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, { ...opts, headers: H });

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

try {
  await c.query("begin");

  // ── the company ───────────────────────────────────────────────────────────
  // Named so nobody can mistake one of its PDFs for the real thing, and with no
  // BRN or VAT number — the CHECK added by 20260804000060 refuses them anyway.
  // Its own prefixes so a sandbox number can never be confused with a real one.
  const sendTo = argSendTo ?? (await c.query(
    "select sandbox_send_to from public.business_settings where id = $1", [SANDBOX_TENANT],
  )).rows[0]?.sandbox_send_to ?? "boodoo.sheik786@gmail.com";

  await c.query(
    `insert into public.business_settings
       (id, legal_name, trading_name, country, vat_rate, prices_vat_exclusive,
        quote_prefix, quote_next_number, invoice_prefix, invoice_next_number,
        credit_note_prefix, credit_note_next_number, z_next_number,
        is_sandbox, sandbox_send_to)
     values ($1, 'TEST SANDBOX — NOT A REAL COMPANY', 'Carfectionist Sandbox', 'MU', 15, false,
             'TESTQ-', 1, 'TESTINV-', 1, 'TESTCN-', 1, 1, true, $2)
     on conflict (id) do update set
       legal_name = excluded.legal_name, is_sandbox = true, sandbox_send_to = excluded.sandbox_send_to`,
    [SANDBOX_TENANT, sendTo],
  );
  console.log(`▸ company: TEST SANDBOX — sends redirected to ${sendTo}`);

  // ── somewhere for stock to live ───────────────────────────────────────────
  const loc = (await c.query(
    `insert into public.stock_locations (tenant_id, name, is_default, is_sales_floor)
     values ($1, 'Shop', true, true)
     on conflict do nothing
     returning id`, [SANDBOX_TENANT],
  )).rows[0]?.id ?? (await c.query(
    "select id from public.stock_locations where tenant_id = $1 limit 1", [SANDBOX_TENANT],
  )).rows[0]?.id;
  console.log(`▸ stock location: ${loc ? "Shop" : "(none — check stock_locations)"}`);

  // ── something to sell ─────────────────────────────────────────────────────
  // Copied from the live catalogue: products are not fiscal, so this costs
  // nothing and means the sandbox looks like the shop you actually work in.
  const copied = (await c.query(
    `insert into public.products (tenant_id, name, kind, selling_price, vat_rate, is_stocked, category, barcode)
     select $1, p.name, p.kind, p.selling_price, p.vat_rate, p.is_stocked, p.category, null
       from public.products p
      where p.tenant_id <> $1
        and not exists (select 1 from public.products q where q.tenant_id = $1 and q.name = p.name)
     returning 1`, [SANDBOX_TENANT],
  )).rowCount;
  const total = (await c.query("select count(*)::int n from public.products where tenant_id = $1", [SANDBOX_TENANT])).rows[0].n;
  console.log(`▸ catalogue: ${copied} copied, ${total} in the sandbox`);

  // ── a customer to quote ───────────────────────────────────────────────────
  const cust = (await c.query(
    `insert into public.customers (tenant_id, name, phone, email)
     values ($1, 'Test Customer', '58811003', $2)
     on conflict do nothing returning id`, [SANDBOX_TENANT, sendTo],
  )).rows[0]?.id ?? (await c.query(
    "select id from public.customers where tenant_id = $1 limit 1", [SANDBOX_TENANT],
  )).rows[0]?.id;
  if (cust) {
    await c.query(
      `insert into public.vehicles (tenant_id, customer_id, plate, make, model)
       values ($1, $2, 'TEST 1', 'Toyota', 'Test Car') on conflict do nothing`, [SANDBOX_TENANT, cust],
    );
  }
  console.log("▸ customer: Test Customer (TEST 1)");

  await c.query("commit");
} catch (e) {
  await c.query("rollback");
  console.error("✗ failed:", e.message);
  await c.end();
  process.exit(1);
}

// ── the login ───────────────────────────────────────────────────────────────
// Outside the transaction: the auth user lives in GoTrue, not in our schema.
let authId = null;
const found = await (await admin(`/users?filter=${encodeURIComponent(EMAIL)}`)).json().catch(() => null);
authId = found?.users?.find((u) => u.email === EMAIL)?.id ?? null;
if (!authId) {
  const made = await (await admin("/users", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { display_name: DISPLAY, role: "owner" } }),
  })).json();
  authId = made?.id ?? null;
}
if (!authId) { console.error("✗ could not create the sandbox auth user"); await c.end(); process.exit(1); }

const pin = String(randomInt(1000, 10000));
const existing = (await c.query(
  "select id, pin_hash from public.app_users where tenant_id = $1 and auth_user_id = $2", [SANDBOX_TENANT, authId],
)).rows[0];
if (existing) {
  console.log(`▸ login: ${DISPLAY} already exists — PIN unchanged`);
} else {
  const u = (await c.query(
    `insert into public.app_users (tenant_id, auth_user_id, display_name, role, is_active)
     values ($1, $2, $3, 'owner', true) returning id`, [SANDBOX_TENANT, authId, DISPLAY],
  )).rows[0];
  await c.query(
    "update public.app_users set pin_hash = extensions.crypt($2, extensions.gen_salt('bf')), pin_set_at = now() where id = $1",
    [u.id, pin],
  );
  console.log(`▸ login: ${DISPLAY}  ·  PIN ${pin}  ·  web ${EMAIL} / ${PASSWORD}`);
}

await c.end();
console.log(`
Sign in on the tablet as "${DISPLAY}" and everything you do is sandboxed —
its own quote and invoice numbers, its own stock, its own till and Z-report.
Sign back in as yourself to return to the real books.

Wipe it whenever you like:  node scripts/reset-sandbox.mjs`);
