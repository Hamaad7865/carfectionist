// Verify the per-row price_includes_vat import: each answer reaches import_products as the right
// p_prices_incl_vat override and stores the right NET price, in BOTH shop settings.
// BEGIN/ROLLBACK — nothing persists. Runs AS the owner via the jwt-claims trick.
//   node scripts/_verify-import-price-basis.mjs
//
// The web action sends a sheet's rows in one call per answer:
//   yes → import_products(rows, false, true)    (price includes VAT → stored net, ÷ (1+rate))
//   no  → import_products(rows, false, false)   (price is net → stored as typed)
//   blank/no column → import_products(rows, false)   (the shop's own setting)
// This proves those three calls against the live function, flipping business_settings both ways.
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (auth uid)

const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 15_000 });
await c.connect();
let failures = 0;
const P = "ZZ PRICE BASIS PROBE";
const r2 = (x) => Math.round(x * 100) / 100;

async function stored() {
  return new Map((await c.query("select name, selling_price::float p, price_includes_vat f from products where name like $1", [`${P}%`])).rows.map((r) => [r.name, r]));
}
function check(label, got, want) {
  const ok = got != null && Math.abs(got - want) < 0.005;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}: stored ${got ?? "MISSING"}  expected ${want}`);
}

try {
  await c.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: OWNER, role: "authenticated" })]);
  await c.query("BEGIN");
  const bs = (await c.query("select vat_rate::float rate from business_settings limit 1")).rows[0];
  const rate = bs.rate;

  for (const quotesGross of [true, false]) {
    await c.query("update business_settings set prices_vat_exclusive = $1", [!quotesGross]);
    const tag = `${P} ${quotesGross ? "G" : "N"}`;
    console.log(`\n── shop quotes ${quotesGross ? "GROSS (prices_vat_exclusive=false)" : "NET (prices_vat_exclusive=true)"} ──`);

    const run = (rows, basis) =>
      basis === null
        ? c.query("select public.import_products($1::jsonb, false)", [JSON.stringify(rows)])
        : c.query("select public.import_products($1::jsonb, false, $2)", [JSON.stringify(rows), basis]);

    await run([{ name: `${tag} yes`, selling_price: "1150.00" }], true);                  // includes VAT
    await run([{ name: `${tag} no`, selling_price: "1150.00" }], false);                   // net
    await run([{ name: `${tag} blank`, selling_price: "1150.00" }], null);                 // shop default
    await run([{ name: `${tag} yes10`, selling_price: "1100.00", vat_rate: "10" }], true); // row rate wins
    await run([{ name: `${tag} yes0`, selling_price: "500.00", vat_rate: "0" }], true);    // zero-rated: as typed

    // UPDATE path on an existing product, both ways
    await run([{ name: `${tag} upd`, selling_price: "100.00" }], false);
    await run([{ name: `${tag} upd`, selling_price: "2300.00" }], true);
    await run([{ name: `${tag} upd2`, selling_price: "100.00" }], true);
    await run([{ name: `${tag} upd2`, selling_price: "2300.00" }], false);

    const s = await stored();
    check(`${tag} yes (1150 incl)`, s.get(`${tag} yes`)?.p, r2(1150 / (1 + rate / 100)));
    check(`${tag} no  (1150 net)`, s.get(`${tag} no`)?.p, 1150);
    check(`${tag} blank (shop default)`, s.get(`${tag} blank`)?.p, quotesGross ? r2(1150 / (1 + rate / 100)) : 1150);
    check(`${tag} yes, row VAT 10%`, s.get(`${tag} yes10`)?.p, r2(1100 / 1.1));
    check(`${tag} yes, zero-rated`, s.get(`${tag} yes0`)?.p, 500);
    check(`${tag} update to 2300 incl`, s.get(`${tag} upd`)?.p, r2(2300 / (1 + rate / 100)));
    check(`${tag} update to 2300 net`, s.get(`${tag} upd2`)?.p, 2300);
  }

  // The flag: import_products must NOT touch it (the web action clears it afterwards, in TypeScript).
  await c.query("update business_settings set prices_vat_exclusive = false");
  const F = `${P} flagged`;
  await c.query("select public.import_products($1::jsonb, false, false)", [JSON.stringify([{ name: F, selling_price: "9900.00" }])]);
  await c.query("update products set price_includes_vat = true where name = $1", [F]);
  await c.query("select public.import_products($1::jsonb, false, true)", [JSON.stringify([{ name: F, selling_price: "9900.00" }])]);
  const f = (await stored()).get(F);
  check("flagged product repriced by an import now holds a NET figure", f?.p, r2(9900 / (1 + rate / 100)));
  const stale = f?.f === true;
  console.log(`${stale ? "✓" : "✗"} import_products leaves price_includes_vat as it was (=${f?.f}) — the web action clears it`);
  if (!stale) failures++;

  console.log(failures === 0 ? "\nPASS — every answer stores the right net price." : `\nFAIL — ${failures} problem(s).`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await c.query("ROLLBACK").catch(() => {});
  await c.end();
}
