// Verify import_products stores NET prices in a gross-quoting shop (the import VAT guard).
// BEGIN/ROLLBACK — nothing persists. Runs AS the owner via the jwt-claims trick.
//   node scripts/_verify-import-vat-guard.mjs
//
// Why: the 2026-07-30 audit found 23 products whose stored (net) price was a VAT-inclusive
// shelf figure that arrived through imports — the till then added 15% on top of a price
// that already included it. The guard makes import_products honour what a price MEANS in
// this shop (business_settings.prices_vat_exclusive), same as the product form does.
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (auth uid)

const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 15_000 });
await c.connect();
let failures = 0;
try {
  await c.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: OWNER, role: "authenticated" }),
  ]);
  await c.query("BEGIN");

  const bs = (await c.query("select vat_rate::float rate, prices_vat_exclusive excl from business_settings limit 1")).rows[0];
  const incl = bs.excl === false; // shop quotes gross → import must convert
  console.log(`settings: vat ${bs.rate}%  prices_vat_exclusive=${bs.excl}  → sheet prices read as ${incl ? "GROSS" : "NET"}\n`);
  const net = (price, rate) => (incl && rate > 0 ? Math.round((price / (1 + rate / 100)) * 100) / 100 : price);

  const P = "ZZ VAT GUARD PROBE"; // unmistakable, rolled back
  const rows = JSON.stringify([
    { name: `${P} A`, selling_price: "1150.00" },                 // default rate applies
    { name: `${P} B`, selling_price: "1100.00", vat_rate: "10" }, // row rate wins
    { name: `${P} C`, selling_price: "500.00", vat_rate: "0" },   // zero-rated: stored as typed
  ]);
  await c.query("select public.import_products($1::jsonb, false)", [rows]);
  // UPDATE path: re-import A with a new shelf price.
  await c.query("select public.import_products($1::jsonb, false)", [
    JSON.stringify([{ name: `${P} A`, selling_price: "2300.00" }]),
  ]);

  const expect = [
    [`${P} A`, net(2300, bs.rate)],
    [`${P} B`, net(1100, 10)],
    [`${P} C`, 500],
  ];

  // Escape hatch: a file that already carries NET prices imports raw when the caller says so.
  // Savepoint so a missing signature (RED) doesn't abort the txn and hide the other checks.
  let hatchOk = false;
  await c.query("SAVEPOINT hatch");
  try {
    await c.query("select public.import_products($1::jsonb, false, false)", [
      JSON.stringify([{ name: `${P} D`, selling_price: "1150.00" }]),
    ]);
    expect.push([`${P} D`, 1150]);
    hatchOk = true;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT hatch");
    console.log(`✗ p_prices_incl_vat override missing (${e.message.split("\n")[0]})`);
    failures++;
  }

  const stored = new Map(
    (await c.query("select name, selling_price::float p from products where name like $1", [`${P}%`])).rows.map((r) => [r.name, r.p]),
  );
  for (const [name, want] of expect) {
    const got = stored.get(name);
    const ok = got != null && Math.abs(got - want) < 0.005;
    if (!ok) failures++;
    console.log(`${ok ? "✓" : "✗"} ${name}: stored ${got ?? "MISSING"}  expected ${want}`);
  }
  if (hatchOk) console.log("✓ explicit p_prices_incl_vat=false stores the file's figure raw");

  console.log(failures === 0 ? "\nPASS — imports store net; the till can never double-charge VAT off a sheet." : `\nFAIL — ${failures} problem(s).`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await c.query("ROLLBACK").catch(() => {});
  await c.end();
}
