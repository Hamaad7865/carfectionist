// Full data reset + reimport from the owner's Cashmag exports.
//   node scripts/_reset-import.mjs --dry-run   (rolls back; prints what WOULD happen)
//   node scripts/_reset-import.mjs             (commits for real)
//
// Wipes every transactional/catalogue row for this tenant (customers, vehicles,
// products, jobs, quotes/invoices, payments, stock, till/Z history, audit log) and
// reimports customers + products + opening stock from the four source files. Leaves
// app_users, business_settings (config), stock_locations, devices, document_templates
// and wa_templates untouched — those are infrastructure, not business data.
import pg from "pg";
import fs from "node:fs";
import { createRequire } from "node:module";
const XLSX = createRequire(import.meta.url)(
  "C:/Users/sheik/AppData/Local/Temp/claude/C--Projects-Carfection/d96d55a3-5671-45f1-8640-34dc81910f59/scratchpad/xlsx-tool/node_modules/xlsx/xlsx.js",
);
import { DB_URL, requireEnv } from "./_env.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh — for JWT claim / RPC context, unused for raw DML
const TENANT = "11111111-1111-4111-8111-000000000001";
const ANESH_APP_USER = "7a3756a9-f7c5-4492-bd6d-9e15f015dc77";
const SHOP_LOC = "0a000000-0000-4000-8000-000000000002";
const WAREHOUSE_LOC = "0a000000-0000-4000-8000-000000000001";
const DL = "C:/Users/sheik/Downloads/";

requireEnv("SUPABASE_DB_URL", DB_URL);

// ── readers ──────────────────────────────────────────────────────────────────
function readXlsx(path) {
  const wb = XLSX.readFile(path);
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
}
// Quote-aware: two company records (SUNLIGHT, WHITE ARROW) wrap their BRN/VAT onto a
// second physical line. Splitting on raw newlines severs them mid-record and every
// column past the break reads as empty — a balance would silently import as zero.
function readCsv(path) {
  const raw = fs.readFileSync(path, "utf8").replace(/^﻿/, "");
  const rows = [];
  let row = [], cur = "", inQ = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQ) {
      if (ch === '"') { if (raw[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ";") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  const data = rows.filter((r) => r.some((cell) => cell.trim().length > 0));
  const header = data[0];
  return data.slice(1).map((cells) => {
    const o = {};
    header.forEach((h, i) => (o[h] = cells[i] ?? ""));
    return o;
  });
}
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
// Collapses the wrapped-field newlines into a single line so an address stays an address.
const norm = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ").trim();
const normKey = (s) => norm(s).toUpperCase();

// ── 1. CUSTOMERS ─────────────────────────────────────────────────────────────
const clientRows = readCsv(DL + "INDIVIDUAL CLIENT.csv");
const customers = [];
let skippedBlankName = 0;
for (const r of clientRows) {
  const nom = norm(r["Nom"]);
  const prenom = norm(r["Prénom"]);
  const societe = norm(r["Société"]);
  const name = societe || [prenom, nom].filter(Boolean).join(" ").trim();
  if (!name) { skippedBlankName++; continue; }

  const balance = Number(r["Solde débiteur"]) || 0;   // money the customer owes the shop
  const cagnotte = Number(r["Cagnotte client"]) || 0; // store credit the shop owes the customer
  const comment = norm(r["Commentaire"]);
  const noteParts = [];
  if (comment) noteParts.push(comment);
  if (balance !== 0) noteParts.push(`Carried from Cashmag — Solde débiteur: Rs ${balance.toFixed(2)} (Cashmag #${r["#ID"]})`);
  if (cagnotte !== 0) noteParts.push(`Carried from Cashmag — Cagnotte (credit owed to customer): Rs ${cagnotte.toFixed(2)} (Cashmag #${r["#ID"]})`);
  if (balance === 0 && cagnotte === 0 && r["#ID"]) noteParts.push(`Cashmag #${r["#ID"]}`);

  // The companies keep their registration numbers in free text (address or comment);
  // invoices need them in their own columns.
  const blob = `${norm(r["Adresse"])} ${comment}`;
  const brn = (blob.match(/BRN\s*([A-Z0-9]{6,})/i) || [])[1] || null;
  const vat = (blob.match(/VAT\s*(?:N[°o]?\s*)?([0-9]{6,})/i) || [])[1] || null;

  customers.push({
    name,
    email: norm(r["Adresse mail"]) || null,
    phone: norm(r["Mobile"]) || norm(r["Fixe"]) || null,
    address: [norm(r["Adresse"]), norm(r["Ville"])].filter(Boolean).join(", ") || null,
    is_company: !!societe,
    brn,
    vat_number: vat,
    // Only an explicit OUI is consent. NON and blank stay opted out, so a post-reset
    // WhatsApp campaign cannot message people who already said no.
    wa_opt_out: normKey(r["Newsletters"]) !== "OUI",
    notes: noteParts.join(" · ") || null,
  });
}

// ── 2. PRODUCTS (dedupe by name, keep the highest price; build an id-alias map) ──
const masterRows = readXlsx(DL + "export_produits_2026-07-07 07_43_43_6a4c920fbdf31.xlsx");
const byName = new Map(); // normKey(name) -> array of rows
for (const r of masterRows) {
  const label = norm(r["Libellé"]) || norm(r["Abrégé"]);
  if (!label) continue;
  const key = normKey(label);
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(r);
}

const products = [];
const idAlias = new Map(); // original Cashmag #ID -> the surviving row's #ID
const usedBarcodes = new Set();
let dedupedAway = 0;
for (const [, rows] of byName) {
  const winner = rows.reduce((best, r) =>
    Number(r["SALES [CAFECTIONIST]"] || 0) > Number(best["SALES [CAFECTIONIST]"] || 0) ? r : best,
  );
  for (const r of rows) idAlias.set(r["#ID"], winner["#ID"]);
  dedupedAway += rows.length - 1;

  const salesIncl = Number(winner["SALES [CAFECTIONIST]"] || 0);
  const sellingExcl = money(salesIncl / 1.15);
  let barcode = norm(winner["Codes barre"]) || null;
  if (barcode && usedBarcodes.has(barcode)) barcode = null; // defend against an accidental collision
  if (barcode) usedBarcodes.add(barcode);

  const threshold = Number(winner["Seuil alerte stock"]) || 0;

  products.push({
    cashmagId: winner["#ID"],
    name: norm(winner["Libellé"]) || norm(winner["Abrégé"]),
    category: norm(winner["Rubrique"]) || null,
    barcode,
    sku: norm(winner["Code produit unique"]) || null,
    description: norm(winner["Description"]) || null,
    selling_price: sellingExcl,
    cost_price: 0, // the master export carries no cost; the stock files fill it in below
    // chk_products_low_stock_threshold caps this at 20 — not an arbitrary clamp.
    low_stock_threshold: threshold > 0 ? Math.min(threshold, 20) : null,
  });
}

// ── 3. STOCK (Shop + Warehouse on-hand, matched by aliased #ID, name fallback) ──
const shopRows = readXlsx(DL + "STOCK SHOP.xlsx");
const whRows = readXlsx(DL + "STOCK WAREHOUSE.xlsx");
const productByCashmagId = new Map(products.map((p) => [p.cashmagId, p]));
const productByName = new Map(products.map((p) => [normKey(p.name), p]));

function resolveStockProduct(row) {
  const aliased = idAlias.get(row["#ID"]) ?? row["#ID"];
  const byId = productByCashmagId.get(aliased);
  if (byId) return byId;
  return productByName.get(normKey(row["Produit"])) ?? null;
}

// Four items sit in the warehouse but were dropped from the catalogue export. They
// exist in the live DB today (price 0, active), so rebuild them from the stock row
// rather than let 43 units of real inventory evaporate. Price stays 0 — Cashmag has
// none to give — so the owner prices them in-app.
const backfilled = [];
for (const rows of [shopRows, whRows]) {
  for (const row of rows) {
    if ((Number(row["Stock"]) || 0) <= 0) continue;
    if (resolveStockProduct(row)) continue;
    const name = norm(row["Produit"]);
    if (!name) continue;
    let barcode = norm(row["Code barre"]) || null;
    if (barcode && usedBarcodes.has(barcode)) barcode = null;
    if (barcode) usedBarcodes.add(barcode);
    const p = {
      cashmagId: row["#ID"],
      name,
      category: norm(row["Rubrique"]) || null,
      barcode,
      sku: null,
      description: null,
      selling_price: 0,
      cost_price: money(row["Coût de revient HT"]),
      low_stock_threshold: null,
    };
    products.push(p);
    productByCashmagId.set(p.cashmagId, p);
    productByName.set(normKey(p.name), p);
    backfilled.push(name);
  }
}

// Cost only exists in the stock exports; carry the highest across the two locations.
for (const rows of [shopRows, whRows]) {
  for (const row of rows) {
    const p = resolveStockProduct(row);
    const cost = money(row["Coût de revient HT"]);
    if (p && cost > (p.cost_price || 0)) p.cost_price = cost;
  }
}

const stockByProduct = new Map(); // cashmagId -> { shop, warehouse }
const unmatchedStock = [];
for (const [rows, loc] of [[shopRows, "shop"], [whRows, "warehouse"]]) {
  for (const row of rows) {
    const qty = Number(row["Stock"]) || 0;
    if (qty <= 0) continue;
    const p = resolveStockProduct(row);
    if (!p) { unmatchedStock.push({ loc, id: row["#ID"], name: row["Produit"], qty }); continue; }
    if (!stockByProduct.has(p.cashmagId)) stockByProduct.set(p.cashmagId, { shop: 0, warehouse: 0 });
    stockByProduct.get(p.cashmagId)[loc] += qty;
  }
}

// ── 4. SERVICES ──────────────────────────────────────────────────────────────
// The detailing menu is not inventory. products_check enforces that a service is
// never stocked, and issue_document decrements stock for every stocked line — so
// leaving these as products drives the whole service menu permanently negative.
// The rubric decides, except where the item actually carries stock (Leather
// Treatment is filed under CAR WASH EXPERTS but is a real bottle on a shelf).
const SERVICE_RUBRICS = new Set(["CAR WASH EXPERTS", "SERVICES FEE"]);
for (const p of products) {
  p.is_service = SERVICE_RUBRICS.has(normKey(p.category)) && !stockByProduct.has(p.cashmagId);
}
const serviceCount = products.filter((p) => p.is_service).length;

console.log("=".repeat(70));
console.log(DRY_RUN ? "DRY RUN — will ROLLBACK, nothing is kept" : "LIVE RUN — will COMMIT");
console.log("=".repeat(70));
console.log(`Customers: ${clientRows.length} rows in file, ${skippedBlankName} blank skipped, ${customers.length} to import`);
console.log(`  opted out of marketing (Newsletters <> OUI): ${customers.filter((x) => x.wa_opt_out).length}`);
console.log(`  carrying a Cashmag balance note: ${customers.filter((x) => /Solde débiteur|Cagnotte/.test(x.notes ?? "")).length}`);
console.log(`  with BRN/VAT captured: ${customers.filter((x) => x.brn || x.vat_number).length}`);
console.log(`Products: ${masterRows.length} rows in file, ${dedupedAway} deduped away (kept the higher price), ${products.length} to import`);
console.log(`  of which services (not stocked): ${serviceCount}`);
console.log(`  backfilled from stock files (absent from the catalogue export): ${backfilled.length}${backfilled.length ? " — " + backfilled.join(", ") : ""}`);
console.log(`Stock: ${stockByProduct.size} products get an opening balance; ${unmatchedStock.length} stock rows had no matching product`);
if (unmatchedStock.length) console.log("  unmatched:", JSON.stringify(unmatchedStock.slice(0, 10)));

// ── EXECUTE ──────────────────────────────────────────────────────────────────
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
await c.query("begin");

try {
  // Append-only / closed-record / fiscal-lock guards refuse ordinary UPDATEs and
  // DELETEs on several tables — that is their entire purpose day-to-day. An
  // authorized full reset is the one legitimate exception; stand them all aside for
  // the whole wipe, then restore them before anything else touches these tables.
  // trg_documents_fiscal_lock also has to be down for the document_lines delete: a
  // recompute-totals trigger on document_lines pushes an UPDATE back onto documents.
  const deleteGuards = [
    ["documents", "trg_documents_fiscal_lock"],
    ["document_lines", "trg_lines_lock"],
    ["payments", "trg_payments_append_only"],
    ["stock_movements", "trg_movements_append_only"],
    ["audit_events", "trg_audit_append_only"],
    ["cash_sessions", "trg_cash_sessions_closed_final"],
    ["till_movements", "trg_till_movements_append_only"],
    ["cash_session_methods", "trg_csm_append_only"],
    ["z_reports", "trg_z_reports_append_only"],
  ];
  for (const [tbl, trg] of deleteGuards) await c.query(`alter table ${tbl} disable trigger ${trg}`);

  // Break the circular documents<->jobs references before either table is cleared.
  await c.query("update jobs set source_quote_id = null where tenant_id = $1", [TENANT]);
  await c.query("update documents set job_id = null, source_document_id = null where tenant_id = $1", [TENANT]);

  // Children before parents, all the way down. These FKs are NO ACTION, so an order
  // that merely happens to work while the peripheral tables are empty is a trap: one
  // appointment booked or one WhatsApp message received before the live run would
  // abort the whole thing after the wipe had already executed.
  const wipeOrder = [
    // children of customers / vehicles / products / certificates
    "appointments", "enquiries", "campaign_recipients", "maintenance_reminders",
    "wa_messages", "wa_conversations",
    "purchase_order_lines", "purchase_orders",
    "stock_transfer_lines", "stock_transfers",
    "service_recipes",
    // the fiscal + job chain
    "certificates", "job_photos", "job_timers", "document_lines",
    "payments", "bank_remittances", "cash_session_methods", "till_movements", "z_reports",
    "documents", "jobs",
    "cash_sessions", "trading_days", "period_closes",
    // the catalogue itself
    "stock_movements", "vehicles", "customers", "products",
    "idempotency_keys", "audit_events",
    "expenses", "suppliers",
  ];
  const wiped = {};
  for (const t of wipeOrder) {
    process.stdout.write(`  deleting ${t}... `);
    const r = await c.query(`delete from public.${t} where tenant_id = $1`, [TENANT]);
    wiped[t] = r.rowCount;
    console.log(r.rowCount);
  }
  console.log("\nWiped:", JSON.stringify(wiped, null, 2));

  for (const [tbl, trg] of deleteGuards) await c.query(`alter table ${tbl} enable trigger ${trg}`);

  await c.query(
    `update business_settings set quote_next_number=1, invoice_next_number=1, credit_note_next_number=1, z_next_number=1 where id=$1`,
    [TENANT],
  );

  // ── insert customers ──
  for (const cu of customers) {
    await c.query(
      `insert into customers (tenant_id, name, email, phone, address, is_company, brn, vat_number, wa_opt_out, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [TENANT, cu.name, cu.email, cu.phone, cu.address, cu.is_company, cu.brn, cu.vat_number, cu.wa_opt_out, cu.notes],
    );
  }

  // ── insert products (capture new id per cashmagId for the stock pass) ──
  const newProductId = new Map();
  for (const p of products) {
    const { rows } = await c.query(
      `insert into products (tenant_id, name, category, barcode, sku, description, kind, unit, selling_price, cost_price, vat_rate, is_stocked, low_stock_threshold, is_active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null,$11,$12,true)
       returning id`,
      [TENANT, p.name, p.category, p.barcode, p.sku, p.description,
        p.is_service ? "service" : "product",
        p.is_service ? "service" : "piece",
        p.selling_price, p.cost_price,
        !p.is_service,
        p.is_service ? null : p.low_stock_threshold],
    );
    newProductId.set(p.cashmagId, rows[0].id);
  }

  // ── opening stock ──
  let stockRowsInserted = 0;
  for (const [cashmagId, qty] of stockByProduct) {
    const pid = newProductId.get(cashmagId);
    if (!pid) continue;
    for (const [loc, amount] of [[SHOP_LOC, qty.shop], [WAREHOUSE_LOC, qty.warehouse]]) {
      if (amount <= 0) continue;
      await c.query(
        `insert into stock_movements (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, note, moved_at, created_by)
         values ($1,$2,$3,$4,0,'adjustment',null,'Opening stock — Cashmag import',now(),$5)`,
        [TENANT, pid, loc, amount, ANESH_APP_USER],
      );
      stockRowsInserted++;
    }
  }

  // ── verification ──
  const counts = {};
  for (const t of ["customers", "products", "vehicles", "jobs", "documents", "payments",
    "stock_movements", "cash_sessions", "trading_days", "z_reports", "audit_events"]) {
    const { rows } = await c.query(`select count(*)::int as n from public.${t} where tenant_id = $1`, [TENANT]);
    counts[t] = rows[0].n;
  }
  const { rows: dupBarcode } = await c.query(
    `select barcode, count(*) from products where tenant_id=$1 and barcode is not null group by barcode having count(*) > 1`,
    [TENANT],
  );
  const { rows: infraCheck } = await c.query(
    `select
      (select count(*) from app_users) as app_users,
      (select count(*) from stock_locations) as stock_locations,
      (select count(*) from devices) as devices,
      (select count(*) from document_templates) as document_templates,
      (select count(*) from wa_templates) as wa_templates,
      (select count(*) from business_settings) as business_settings`,
  );

  const { rows: onHand } = await c.query(
    `select coalesce(sum(qty),0)::numeric as units from stock_movements where tenant_id=$1`,
    [TENANT],
  );
  const { rows: svc } = await c.query(
    `select count(*)::int as n from products where tenant_id=$1 and kind='service' and is_stocked=false`,
    [TENANT],
  );
  const { rows: optOut } = await c.query(
    `select count(*)::int as n from customers where tenant_id=$1 and wa_opt_out`,
    [TENANT],
  );

  console.log("\nFinal counts:", JSON.stringify(counts, null, 2));
  console.log("Stock movement rows inserted:", stockRowsInserted, "| total units on hand:", onHand[0].units);
  console.log("Services (kind=service, not stocked):", svc[0].n, "| customers opted out of marketing:", optOut[0].n);
  console.log("Duplicate barcodes remaining (should be empty):", JSON.stringify(dupBarcode));
  console.log("Infra untouched (should match pre-run: 2 devices, 1 template, 1 wa_template, stock_locations=2):", JSON.stringify(infraCheck[0]));

  // Every source row must land somewhere. The previous version of these assertions
  // passed while quietly dropping 43 units of warehouse stock on the floor.
  if (skippedBlankName !== 0) throw new Error(`${skippedBlankName} customer rows had no name — the CSV is being mis-read`);
  if (unmatchedStock.length > 0) throw new Error(`stock with no product: ${JSON.stringify(unmatchedStock)}`);
  if (counts.customers !== customers.length) throw new Error(`customer count mismatch: expected ${customers.length}, got ${counts.customers}`);
  if (counts.products !== products.length) throw new Error(`product count mismatch: expected ${products.length}, got ${counts.products}`);
  if (svc[0].n !== serviceCount) throw new Error(`service count mismatch: expected ${serviceCount}, got ${svc[0].n}`);
  const expectedUnits = [...stockByProduct.values()].reduce((s, q) => s + q.shop + q.warehouse, 0);
  if (Number(onHand[0].units) !== expectedUnits) throw new Error(`stock units mismatch: expected ${expectedUnits}, got ${onHand[0].units}`);
  if (dupBarcode.length > 0) throw new Error("duplicate barcodes survived import");
  for (const t of ["jobs", "documents", "payments", "vehicles", "cash_sessions", "trading_days", "z_reports", "audit_events"]) {
    if (counts[t] !== 0) throw new Error(`${t} should be 0 after wipe, got ${counts[t]}`);
  }

  if (DRY_RUN) {
    await c.query("rollback");
    console.log("\n✓ Dry run passed all assertions — ROLLED BACK, nothing kept.");
  } else {
    await c.query("commit");
    console.log("\n✓ COMMITTED.");
  }
} catch (e) {
  await c.query("rollback");
  console.error("\n✗ FAILED, rolled back:", e.message);
  console.error("  detail:", e.detail, "\n  table:", e.table, "\n  constraint:", e.constraint, "\n  where:", e.where);
  process.exitCode = 1;
} finally {
  await c.end();
}
