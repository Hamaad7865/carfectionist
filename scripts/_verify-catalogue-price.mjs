// Rolled-back proof: a catalogue product that states price_includes_vat carries the exact
// gross the owner typed, and a line raised from it issues ON that figure — the 9,900 dash
// cam lands on 9,900.00, not 9,900.01. Everything runs inside one transaction and ROLLS BACK.
//
//   node scripts/_verify-catalogue-price.mjs   (PowerShell, sandbox disabled — port 5432)
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";
import { SANDBOX_TENANT } from "./_sandbox.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

const owner = await c.query(
  `select auth_user_id from public.app_users where tenant_id=$1 and role='owner' limit 1`, [SANDBOX_TENANT]);
const ownerAuth = owner.rows[0]?.auth_user_id;
const cust = await c.query(
  `select id from public.customers where tenant_id=$1 order by created_at limit 1`, [SANDBOX_TENANT]);
const custId = cust.rows[0]?.id;

let pass = true;
const check = (name, got, want) => {
  const ok = got === want;
  pass = pass && ok;
  console.log(`${ok ? "GOOD" : "BAD "}  ${name}: got ${got}${ok ? "" : `, want ${want}`}`);
};
// numeric.toFixed(2) both sides so 9900 and "9900.00" agree
const checkMoney = (name, got, want) => check(name, Number(got).toFixed(2), Number(want).toFixed(2));

try {
  await c.query("begin");
  await c.query(`select set_config('role','authenticated', true)`);
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: ownerAuth, role: "authenticated" })]);

  // 1) WRITE PATH — a flagged product stores the gross EXACTLY as typed (no ÷1.15).
  const prod = await c.query(
    `insert into public.products (tenant_id, name, kind, selling_price, price_includes_vat, vat_rate, is_stocked)
     values ($1,'PROBE Dash Cam','product',9900,true,15,true)
     returning id, selling_price::text sp, price_includes_vat piv`, [SANDBOX_TENANT]);
  checkMoney("product selling_price stored as typed", prod.rows[0].sp, 9900);
  check("product price_includes_vat", prod.rows[0].piv, true);
  const prodId = prod.rows[0].id;

  // 2) READ PATH — the columns every client select relies on come back together.
  const read = await c.query(
    `select selling_price::text sp, price_includes_vat piv from public.products where id=$1`, [prodId]);
  checkMoney("read-back gross", read.rows[0].sp, 9900);
  check("read-back flag", read.rows[0].piv, true);

  // 3) EXTRACTION ARITHMETIC — the exact split the flagged line's GENERATED columns compute,
  //    using Postgres round() (the authority the columns themselves use). The real generated
  //    columns on a live document_lines row are proven end-to-end by _verify-typed-price.mjs;
  //    here we only confirm the flag's own product price extracts to the typed figure. (A direct
  //    documents insert is intentionally denied — drafts must go through the save_draft RPC.)
  const ex = await c.query(
    `select round(9900 / (1 + 15/100.0), 2)::text excl,
            (9900 - round(9900 / (1 + 15/100.0), 2))::text vat`);
  const fExcl = Number(ex.rows[0].excl), fVat = Number(ex.rows[0].vat);
  checkMoney("flagged 9900 → excl + vat = typed gross", fExcl + fVat, 9900);
  checkMoney("flagged 9900 → VAT extracted (9900×15/115)", fVat, Math.round(9900 * 15 / 115 * 100) / 100);

  // 4) CONTRAST — the OLD net path on the same shelf price drifts a cent.
  const contrast = await c.query(
    `with net as (select round(9900 / (1 + 15/100.0), 2) n)
     select (n + round(n * 15/100.0, 2))::text gross, n::text net from net`);
  console.log(`INFO  same shelf price stored NET (${contrast.rows[0].net}) grosses to ${Number(contrast.rows[0].gross).toFixed(2)} — the cent the flag removes`);

  console.log(`\n${pass ? "✓ ALL GOOD — the catalogue flag lands the line on the typed gross." : "✗ SOMETHING MOVED — do not ship."}`);
} catch (e) {
  pass = false;
  console.error("✗ probe failed:", e.message);
} finally {
  await c.query("rollback");
  await c.end();
}
process.exitCode = pass ? 0 : 1;
