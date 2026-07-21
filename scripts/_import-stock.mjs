// One-off: load "NewStock 2026 P444.xlsx" as the shop's stocked-goods catalogue.
//   node scripts/_import-stock.mjs            → dry run (ROLLBACK, prints what would happen)
//   node scripts/_import-stock.mjs --commit   → for real
//
// The sheet turned out to be a SUPERSET of what was on file — all 119 existing products
// appear in it — so nothing is deleted. Existing items are re-priced and re-categorised,
// the new ones are added, and the Shop count is adjusted to exactly what the sheet says.
//
// Stock is an append-only ledger (trg_movements_append_only), so the count is corrected
// with an adjustment movement per product, never by rewriting history. Services
// (kind='service') are untouched throughout.
import fs from "node:fs";
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);

const SRC = "C:/Users/sheik/AppData/Local/Temp/claude/C--Projects-Carfection/d96d55a3-5671-45f1-8640-34dc81910f59/scratchpad/new-stock.json";
const TENANT = "11111111-1111-4111-8111-000000000001";
const SHOP = "0a000000-0000-4000-8000-000000000002"; // the sales floor the POS sells from
const NOTE = "Stock take — NewStock 2026 P444";
const COMMIT = process.argv.includes("--commit");

const sheet = JSON.parse(fs.readFileSync(SRC, "utf8"));
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

try {
  await c.query("BEGIN");

  const before = await c.query("select kind::text, count(*)::int n from public.products group by 1 order by 1");
  console.log("BEFORE products:", before.rows.map((r) => `${r.kind}=${r.n}`).join(" "));

  // ── existing stocked goods, by name ──
  const cur = await c.query("select id, name, selling_price::float price, category from public.products where kind='product'");
  const byName = new Map(cur.rows.map((r) => [r.name.trim().toLowerCase(), r]));

  const updates = [];
  const inserts = [];
  for (const r of sheet) {
    const hit = byName.get(r.name.trim().toLowerCase());
    if (hit) updates.push({ ...r, id: hit.id });
    else inserts.push(r);
  }
  const sheetNames = new Set(sheet.map((r) => r.name.trim().toLowerCase()));
  const orphans = cur.rows.filter((r) => !sheetNames.has(r.name.trim().toLowerCase()));
  console.log(`matched ${updates.length} existing · new ${inserts.length} · not in sheet ${orphans.length}`);

  // ── 1. re-price / re-categorise the ones already on file ──
  for (const u of updates) {
    await c.query(
      "update public.products set selling_price=$1, category=$2, is_active=true, is_stocked=true, updated_at=now() where id=$3",
      [u.price, u.category, u.id],
    );
  }
  console.log("updated existing products:", updates.length);

  // ── 2. add the genuinely new ones ──
  let insertedRows = [];
  if (inserts.length) {
    const pv = [];
    const pp = [];
    inserts.forEach((r, i) => {
      const b = i * 4;
      pv.push(`($${b + 1},$${b + 2},'product','piece',$${b + 3},0,true,true,$${b + 4})`);
      pp.push(TENANT, r.name, r.price, r.category);
    });
    const ins = await c.query(
      `insert into public.products (tenant_id, name, kind, unit, selling_price, cost_price, is_stocked, is_active, category)
       values ${pv.join(",")} returning id, name`,
      pp,
    );
    insertedRows = ins.rows;
  }
  console.log("inserted new products:", insertedRows.length);

  // ── 3. anything on file the sheet doesn't list → archive (hidden from POS) ──
  if (orphans.length) {
    await c.query("update public.products set is_active=false, updated_at=now() where id = any($1::uuid[])", [
      orphans.map((o) => o.id),
    ]);
    console.log("archived (not in sheet):", orphans.length, orphans.slice(0, 5).map((o) => o.name).join(" | "));
  }

  // ── 4. correct the Shop count to exactly what the sheet says ──
  const idByName = new Map([...updates.map((u) => [u.name, u.id]), ...insertedRows.map((r) => [r.name, r.id])]);
  const onHand = await c.query(
    "select product_id, qty_on_hand::float q from public.stock_on_hand where location_id=$1",
    [SHOP],
  );
  const haveByPid = new Map(onHand.rows.map((r) => [r.product_id, r.q]));

  const mv = [];
  const mp = [];
  let n = 0;
  for (const r of sheet) {
    const pid = idByName.get(r.name);
    if (!pid) continue;
    const delta = r.qty - (haveByPid.get(pid) ?? 0);
    if (delta === 0) continue;
    const b = n * 2;
    mv.push(`('${TENANT}',$${b + 1},'${SHOP}',$${b + 2},'adjustment','${NOTE}')`);
    mp.push(pid, delta);
    n += 1;
  }
  if (mv.length) {
    await c.query(
      `insert into public.stock_movements (tenant_id, product_id, location_id, qty, ref_type, note)
       values ${mv.join(",")}`,
      mp,
    );
  }
  console.log("stock adjustments written:", mv.length);

  // ── verify, inside the transaction ──
  const after = await c.query("select kind::text, count(*)::int n from public.products where is_active group by 1 order by 1");
  console.log("AFTER active products:", after.rows.map((r) => `${r.kind}=${r.n}`).join(" "));
  const oh = await c.query(
    "select count(*)::int items, coalesce(sum(qty_on_hand),0)::int units from public.stock_on_hand where location_id=$1 and qty_on_hand > 0",
    [SHOP],
  );
  console.log(`on hand at Shop: ${oh.rows[0].items} items / ${oh.rows[0].units} units  (sheet says 273 / 869)`);
  const neg = await c.query("select count(*)::int n from public.stock_on_hand where qty_on_hand < 0");
  console.log("negative on-hand rows:", neg.rows[0].n);
  const zero = await c.query("select count(*)::int n from public.products where kind='product' and is_active and selling_price = 0");
  console.log("active goods priced Rs 0:", zero.rows[0].n);
  const svc = await c.query("select count(*)::int n from public.products where kind='service' and is_active");
  console.log("services still active:", svc.rows[0].n);
  const sample = await c.query(
    `select p.name, p.category, p.selling_price::float price, coalesce(s.qty_on_hand,0)::int qty
     from public.products p left join public.stock_on_hand s on s.product_id=p.id and s.location_id=$1
     where p.kind='product' and p.is_active order by p.name limit 6`,
    [SHOP],
  );
  console.table(sample.rows);

  if (COMMIT) {
    await c.query("COMMIT");
    console.log("\n*** COMMITTED ***");
  } else {
    await c.query("ROLLBACK");
    console.log("\n(dry run — rolled back, nothing changed)");
  }
} catch (e) {
  await c.query("ROLLBACK");
  console.error("FAILED, rolled back:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
