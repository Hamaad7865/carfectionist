// Rebuild the catalogue, customers and stock from the owner's exports.
//
//   node scripts/import/build.py   (first — produces payload.json + report.json)
//   node scripts/import/load.mjs --dry     inspect, write nothing
//   node scripts/import/load.mjs --commit  wipe + load, in ONE transaction
//
// Destructive by design: everything tenant-scoped goes except the staff logins.
// KEPT deliberately: app_users (the 8 people), business_settings (the tenant
// root), stock_locations (Warehouse/Shop are referenced by the movements we're
// about to write), document_templates, devices (tablets would otherwise have to
// re-register), and wa_templates — those mirror templates that exist on META's
// side; deleting our rows would not delete theirs, and we'd never be able to
// recreate them under the same name.
//
// Everything runs in a single transaction: it either all lands or none of it does.
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DB_URL } from "../_env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const payload = JSON.parse(fs.readFileSync(path.join(HERE, "payload.json"), "utf8"));
const COMMIT = process.argv.includes("--commit");

const WIPE = [
  // children first — TRUNCATE ... CASCADE handles it, but being explicit documents intent
  "document_lines", "payments", "documents",
  "stock_movements", "stock_transfer_lines", "stock_transfers",
  "job_photos", "job_timers", "jobs",
  "service_recipes", "purchase_order_lines", "purchase_orders",
  "certificates", "maintenance_reminders", "expenses", "enquiries",
  "audit_events", "idempotency_keys",
  "scheduled_sends", "wa_messages", "wa_conversations", "campaign_recipients", "campaigns",
  "till_movements", "z_reports", "period_closes", "cash_sessions",
  "appointments",
  "vehicles", "customers", "products",
];

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

const count = async (t) => {
  try { return (await c.query(`select count(*)::int n from ${t}`)).rows[0].n; } catch { return "-"; }
};

try {
  const tenant = (await c.query("select id from business_settings limit 1")).rows[0].id;
  const locs = Object.fromEntries((await c.query("select name, id from stock_locations")).rows.map((r) => [r.name, r.id]));
  const staff = await count("app_users");

  console.log("tenant:", tenant);
  console.log("locations:", Object.keys(locs).join(", "));
  console.log("staff logins to KEEP:", staff);
  console.log("");
  console.log("payload:", payload.services.length, "services |", payload.products.length, "products |",
              payload.clients.length, "clients |", payload.movements.length, "stock movements");

  if (!COMMIT) {
    console.log("\n--- DRY RUN: nothing written. Re-run with --commit to apply. ---");
    console.log("would delete:");
    for (const t of ["documents", "payments", "customers", "products", "stock_movements", "jobs"]) {
      console.log(`  ${t.padEnd(18)} ${await count(t)} rows`);
    }
    await c.end();
    process.exit(0);
  }

  await c.query("begin");

  // ── wipe ──
  await c.query(`truncate ${WIPE.join(", ")} cascade`);
  await c.query(
    "update business_settings set quote_next_number = 1, invoice_next_number = 1, credit_note_next_number = 1 where id = $1",
    [tenant],
  );

  // ── catalogue ──
  const catalogue = [...payload.services, ...payload.products];
  const idOf = new Map();
  for (const p of catalogue) {
    const isService = p.kind === "service";
    const r = await c.query(
      `insert into products (tenant_id, name, category, kind, unit, selling_price, cost_price,
                             barcode, low_stock_threshold, is_stocked, is_active)
       values ($1,$2,$3,$4::product_kind,$5::product_unit,$6,$7,$8,$9,$10,true) returning id`,
      [
        tenant, p.name, p.category, p.kind,
        isService ? "service" : "piece",
        p.price, p.cost || 0,
        p.barcode || null,
        p.threshold || null,
        !isService,          // services are never stocked
      ],
    );
    idOf.set(p.name, r.rows[0].id);
  }

  // ── customers ──
  for (const cl of payload.clients) {
    await c.query(
      "insert into customers (tenant_id, name, phone, email, address, country, is_company) values ($1,$2,$3,$4,$5,'MU',$6)",
      [tenant, cl.name, cl.phone, cl.email, cl.address, cl.is_company],
    );
  }

  // ── opening stock (append-only ledger: adjustments, never an UPDATE) ──
  let moves = 0;
  for (const m of payload.movements) {
    const pid = idOf.get(m.product);
    const loc = locs[m.location];
    if (!pid || !loc) continue;
    await c.query(
      `insert into stock_movements (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, note)
       values ($1,$2,$3,$4,0,'adjustment',null,'Opening stock — imported from Cashmag')`,
      [tenant, pid, loc, m.qty],
    );
    moves++;
  }

  await c.query("commit");

  console.log("\n✓ committed. now in the database:");
  for (const t of ["products", "customers", "stock_movements", "documents", "payments", "app_users"]) {
    console.log(`  ${t.padEnd(18)} ${await count(t)}`);
  }
  const kinds = await c.query("select kind::text, count(*)::int n from products group by 1 order by 1");
  console.log("  by kind:", kinds.rows.map((r) => `${r.kind}=${r.n}`).join(" "));
  console.log("  stock movements written:", moves);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("✗ FAILED — rolled back, nothing changed:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
