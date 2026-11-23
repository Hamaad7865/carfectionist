// Brand + tyre size (20261127000010) against the live database, as the TEST tyre-centre owner.
//
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-product-brand-size.mjs          # ROLLS BACK
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-product-brand-size.mjs --keep   # keeps the sandbox data
//
// Before the migration is pushed it applies the migration file inside the transaction (always
// rolled back). --keep is refused until the columns exist for real; it then leaves brands and
// sizes on the TEST sandbox's 4 tyres (tenant 44444444-…0004) and nothing else.
//
// Proves: the migration applies; the owner can write brand/size under RLS (as saveProductAction
// does); the web's and the tablet's product selects return them; the size↔brand answers computed
// by the shared tyre-size.ts from the DB rows; the positive-size check; RLS keeps other shops out.
import fs from "node:fs";
import pg from "pg";
import { brandsForSize, sizesForBrand, parseSizeQuery, sizeFromColumns, brandKey } from "../apps/web/src/lib/products/tyre-size.ts";

const KEEP = process.argv.includes("--keep");
const SANDBOX = "44444444-4444-4444-8444-000000000004";
const OWNER = "2f6a42e9-e2aa-4cd5-badd-cdf26ff1e35c"; // TEST Tyre Owner (auth user)
// (id, name) pinned: the script only ever writes these four rows.
const TYRES = [
  { id: "7761cf76-6f36-4ec3-bb9b-ad8ce9370d72", name: "TEST Tyre 175/65 R14", brand: "Bridgestone", w: 175, p: 65, r: 14, li: "82", sr: "T" },
  { id: "5c11ad0d-6e84-483c-9d50-ffed5f2882f6", name: "TEST Tyre 185/65 R15", brand: "Bridgestone", w: 185, p: 65, r: 15, li: "88", sr: "H" },
  { id: "d51338c7-7d68-4ced-b3b2-84c8c4dfdc10", name: "TEST Tyre 195/65 R15", brand: "Michelin", w: 195, p: 65, r: 15, li: "91", sr: "H" },
  { id: "4d5ab7ba-8c8c-409c-a62c-ac0df6f36f43", name: "TEST Tyre 205/55 R16", brand: "Michelin", w: 205, p: 55, r: 16, li: "91", sr: "V" },
];
const WEB_SELECT = "id, name, brand, tyre_width, tyre_profile, tyre_rim, tyre_load_index, tyre_speed_rating"; // + the existing columns
const TABLET_SELECT = "id, name, kind, selling_price, price_includes_vat, vat_rate, barcode, is_stocked, category, low_stock_threshold, photo_path, discount_policy, brand, tyre_width, tyre_profile, tyre_rim, tyre_load_index, tyre_speed_rating";

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${JSON.stringify(got)}${ok ? "" : `  (want ${JSON.stringify(want)})`}`);
};

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const rows = async (text, params) => (await c.query(text, params)).rows;
const asOwner = async () => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: OWNER, role: "authenticated" })]);
};
const asAdmin = () => c.query("reset role");

const pushed = (await rows(`select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='brand'`)).length > 0;
if (KEEP && !pushed) {
  console.error("--keep refused: migration 20261127000010 is not pushed yet (no products.brand column).");
  process.exit(2);
}

await c.query("begin");
await c.query("set local lock_timeout = '5s'");
try {
  if (!pushed) {
    console.log("Migration not pushed — applying 20261127000010 inside the transaction (rolled back).");
    await c.query(fs.readFileSync("supabase/migrations/20261127000010_product_brand_and_tyre_size.sql", "utf8"));
  } else console.log("Migration already pushed.");

  console.log("\nWrite brand + size as the TEST tyre-centre owner (RLS, like saveProductAction):");
  await asOwner();
  for (const t of TYRES) {
    const r = await rows(
      `update public.products set brand=$3, tyre_width=$4, tyre_profile=$5, tyre_rim=$6, tyre_load_index=$7, tyre_speed_rating=$8
        where id=$1 and name=$2 and tenant_id=$9 returning id`,
      [t.id, t.name, t.brand, t.w, t.p, t.r, t.li, t.sr, SANDBOX],
    );
    check(`${t.name} updated`, r.length, 1);
  }

  console.log("\nThe web's and the tablet's selects return them:");
  const web = await rows(`select ${WEB_SELECT} from public.products where tenant_id=$1 and category='Tyres' order by name`, [SANDBOX]);
  check("web select: 4 tyres with brand", web.map((r) => r.brand), ["Bridgestone", "Bridgestone", "Michelin", "Michelin"]);
  check("205/55 R16 reads back", sizeFromColumns(web[3].tyre_width, web[3].tyre_profile, web[3].tyre_rim), { width: 205, profile: 55, rim: 16 });
  const tablet = await rows(`select ${TABLET_SELECT} from public.products where is_active order by kind, name`);
  check("tablet select sees only its own shop", tablet.length, (await rows(`select count(*)::int n from public.products where is_active`))[0].n);
  check("tablet select: load+speed on 205/55 R16", tablet.filter((r) => r.name === "TEST Tyre 205/55 R16").map((r) => `${r.tyre_load_index}${r.tyre_speed_rating}`), ["91V"]);
  check("RLS: no other shop's products visible", (await rows(`select count(*)::int n from public.products where tenant_id <> $1`, [SANDBOX]))[0].n, 0);

  console.log("\nSize ↔ brand, computed by the shared tyre-size.ts from the DB rows:");
  const items = tablet.map((r) => ({ brand: r.brand, size: sizeFromColumns(r.tyre_width, r.tyre_profile, r.tyre_rim), qty: 0 }));
  check("type R15 → brands", brandsForSize(items, parseSizeQuery("R15")).map((b) => [b.brand, b.products]), [["Bridgestone", 1], ["Michelin", 1]]);
  check("type 205/55 → brands", brandsForSize(items, parseSizeQuery("205/55")).map((b) => [b.brand, b.products]), [["Michelin", 1]]);
  check("type 2055516 → brands", brandsForSize(items, parseSizeQuery("2055516")).map((b) => b.brand), ["Michelin"]);
  check("pick Michelin → sizes", sizesForBrand(items, brandKey("michelin")).map((s) => s.label), ["195/65 R15", "205/55 R16"]);
  check("pick Bridgestone → sizes", sizesForBrand(items, "bridgestone").map((s) => s.label), ["175/65 R14", "185/65 R15"]);

  console.log("\nThe database refuses a zero size:");
  await c.query("savepoint z");
  let refused = false;
  try {
    await c.query(`update public.products set tyre_width = 0 where id=$1`, [TYRES[0].id]);
  } catch (e) {
    refused = /products_tyre_size_positive/.test(e.message);
  }
  await c.query("rollback to savepoint z");
  check("tyre_width = 0 refused", refused, true);
  await asAdmin();

  if (failures === 0 && KEEP) {
    await c.query("commit");
    console.log("\nALL GOOD — COMMITTED: brands and sizes kept on the 4 TEST sandbox tyres only.");
  } else {
    await c.query("rollback");
    console.log(failures === 0 ? "\nALL GOOD — rolled back, nothing kept." : `\n${failures} FAILED — rolled back.`);
  }
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("ERROR — rolled back:", e.message);
  failures++;
} finally {
  await c.end();
}
process.exit(failures ? 1 : 0);
