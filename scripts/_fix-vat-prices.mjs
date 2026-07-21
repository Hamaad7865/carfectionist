// One-off: stored selling_price must be VAT-EXCLUSIVE.
//   node scripts/_fix-vat-prices.mjs            → dry run (ROLLBACK)
//   node scripts/_fix-vat-prices.mjs --commit   → for real
//
// The shop thinks and quotes in VAT-INCLUSIVE prices ("SILVER SUV is 1540"), and the web
// is built for that: with business_settings.prices_vat_exclusive = false it renders and
// accepts the GROSS price (CataloguePanel.sellOf / ProductFormModal) while storing the NET.
// Seeded + imported rows skipped that conversion, so the net column held gross figures and
// the till added 15% on top of a price that already included it (1540 → 1771).
//
// Divide by (1 + vat) so the ledger's own maths lands back on the shelf price:
//   line_total_excl = qty * unit_price ; line_vat = round(excl * rate/100, 2)
import pg from "pg";
import fs from "node:fs";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const COMMIT = process.argv.includes("--commit");
const BACKUP = "C:/Users/sheik/AppData/Local/Temp/claude/C--Projects-Carfection/d96d55a3-5671-45f1-8640-34dc81910f59/scratchpad/backup-prices-before-vat-fix.json";

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

try {
  const vatRow = await c.query("select vat_rate::float v, prices_vat_exclusive from public.business_settings limit 1");
  const VAT = vatRow.rows[0].v;
  console.log(`vat_rate=${VAT}%  prices_vat_exclusive=${vatRow.rows[0].prices_vat_exclusive} (false = shop quotes gross)`);

  // Snapshot every price first — this is money.
  const snap = await c.query("select id, name, kind::text, selling_price::float price from public.products");
  fs.writeFileSync(BACKUP, JSON.stringify(snap.rows, null, 1));
  console.log("backed up", snap.rowCount, "prices →", BACKUP.split("/").pop());

  await c.query("BEGIN");

  const upd = await c.query(
    `update public.products
        set selling_price = round(selling_price / (1 + $1::numeric / 100), 2), updated_at = now()
      where is_active and selling_price > 0
      returning id`,
    [VAT],
  );
  console.log("converted prices:", upd.rowCount);

  // Round-trip using the ledger's EXACT formula, qty = 1.
  const rt = await c.query(
    `select count(*)::int total,
            count(*) filter (
              where (selling_price + round(selling_price * $1::numeric / 100, 2)) <> round(selling_price * (1 + $1::numeric/100), 2)
            )::int odd
       from public.products where is_active and selling_price > 0`,
    [VAT],
  );
  console.log("round-trip anomalies:", rt.rows[0].odd, "of", rt.rows[0].total);

  const sample = await c.query(
    `select name, kind::text kind, selling_price::float net,
            round(selling_price * $1::numeric/100, 2)::float vat,
            (selling_price + round(selling_price * $1::numeric/100, 2))::float customer_pays
       from public.products
      where name in ('SILVER SUV','SILVER SEDAN','SILVER 4X4/VAN','Car Diffuser Silver MTN','Aladin Handy Dryer')
      order by name`,
    [VAT],
  );
  console.log("=== what the customer will now pay ===");
  console.table(sample.rows);

  const tot = await c.query(
    `select coalesce(sum(s.qty_on_hand * p.selling_price),0)::float net,
            coalesce(sum(s.qty_on_hand * (p.selling_price + round(p.selling_price * $1::numeric/100,2))),0)::float gross
       from public.stock_on_hand s join public.products p on p.id=s.product_id
      where s.qty_on_hand>0 and p.is_active`,
    [VAT],
  );
  const f = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  console.log(`stock value → net Rs ${f(tot.rows[0].net)} | gross Rs ${f(tot.rows[0].gross)}`);

  if (COMMIT) {
    await c.query("COMMIT");
    console.log("\n*** COMMITTED ***");
  } else {
    await c.query("ROLLBACK");
    console.log("\n(dry run — rolled back)");
  }
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error("FAILED, rolled back:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
