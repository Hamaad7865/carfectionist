// One-off: merge the four duplicate "Lucas Lutchmoodoo" customer records.
//
// How they happened: intake searched only its local cache, so the customer created moments
// earlier was invisible and staff created him again — four times. Each retry then collided on
// the vehicle's unique plate, so the real car (2211 MR 23) ended up on the FIRST record while
// the accepted quote A00025 and its job sat on a THIRD, against a vehicle plated "NIL" — the
// placeholder someone typed to get past the rejection. (Both root causes are fixed in the app.)
//
// The keeper is the record holding the REAL plate. Everything else is moved onto it, the
// placeholder vehicle is removed, and the empty duplicates are deleted.
//
//   node scripts/_merge-lucas-duplicates.mjs           # dry run — prints the plan, writes nothing
//   node scripts/_merge-lucas-duplicates.mjs --commit  # apply, inside one transaction
//
// A snapshot of every affected row is written to scratch before anything changes.
import pg from "pg";
import { writeFileSync } from "node:fs";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const COMMIT = process.argv.includes("--commit");

const KEEP = "92e19a4d-be76-427c-82fa-4da070fc9f9e"; // holds 2211 MR 23
const DROP = [
  "144a4b0a-a385-4847-ba44-72d74dce93ec",
  "51d45d88-ff4f-4e55-bec3-79df593f0234", // holds A00025 + its job + the "NIL" vehicle
  "948989e4-71f9-4a55-a557-58cc025665ff",
];

// Every table that points at a customer, and the column it uses.
const CUSTOMER_REFS = [
  ["jobs", "customer_id"], ["documents", "customer_id"], ["certificates", "customer_id"],
  ["maintenance_reminders", "customer_id"], ["enquiries", "converted_customer_id"],
  ["appointments", "customer_id"], ["campaign_recipients", "customer_id"],
  ["wa_conversations", "customer_id"],
];
const VEHICLE_REFS = [
  ["jobs", "vehicle_id"], ["documents", "vehicle_id"], ["certificates", "vehicle_id"],
  ["maintenance_reminders", "vehicle_id"], ["enquiries", "converted_vehicle_id"],
  ["appointments", "vehicle_id"],
];

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
await c.query("BEGIN");

try {
  const keeper = (await c.query("select id, name, phone from customers where id = $1", [KEEP])).rows[0];
  if (!keeper) throw new Error("the keeper record no longer exists — re-check the ids before running this");

  // The real car: the keeper's vehicle that is NOT the placeholder.
  const realCar = (await c.query(
    "select id, plate, make, model from vehicles where customer_id = $1 and plate <> 'NIL' order by created_at limit 1",
    [KEEP],
  )).rows[0];
  if (!realCar) throw new Error("the keeper has no real plate — nothing to merge onto");

  console.log(`KEEP  ${keeper.name} (${keeper.phone ?? "no phone"})  ->  ${realCar.plate}  ${realCar.make ?? ""} ${realCar.model ?? ""}`.trim());

  // Snapshot everything that is about to move or go.
  const snapshot = { keeper, realCar, drop: [] };
  for (const id of DROP) {
    const cust = (await c.query("select * from customers where id = $1", [id])).rows[0];
    if (!cust) { console.log(`\n(already gone: ${id.slice(0, 8)})`); continue; }
    const rows = {};
    for (const [t, col] of CUSTOMER_REFS) {
      const r = await c.query(`select * from ${t} where ${col} = $1`, [id]);
      if (r.rowCount) rows[t] = r.rows;
    }
    const vehicles = (await c.query("select * from vehicles where customer_id = $1", [id])).rows;
    snapshot.drop.push({ customer: cust, rows, vehicles });
  }
  writeFileSync("scripts/.merge-lucas-snapshot.json", JSON.stringify(snapshot, null, 2));
  console.log("snapshot written to scripts/.merge-lucas-snapshot.json");

  let moved = 0;
  for (const id of DROP) {
    if (!(await c.query("select 1 from customers where id = $1", [id])).rowCount) continue;
    console.log(`\nMERGE ${id.slice(0, 8)}`);

    // 1. Anything pointing at the placeholder vehicle moves to the real car FIRST — a job or a
    //    quote must never be left pointing at a vehicle that is about to be deleted.
    const placeholders = (await c.query("select id, plate from vehicles where customer_id = $1", [id])).rows;
    for (const v of placeholders) {
      for (const [t, col] of VEHICLE_REFS) {
        const r = await c.query(`update ${t} set ${col} = $1 where ${col} = $2 returning 1`, [realCar.id, v.id]);
        if (r.rowCount) { console.log(`   ${t}.${col}: ${r.rowCount} × ${v.plate} -> ${realCar.plate}`); moved += r.rowCount; }
      }
    }

    // 2. Then re-point everything that named this customer.
    for (const [t, col] of CUSTOMER_REFS) {
      const r = await c.query(`update ${t} set ${col} = $1 where ${col} = $2 returning 1`, [KEEP, id]);
      if (r.rowCount) { console.log(`   ${t}.${col}: ${r.rowCount} -> keeper`); moved += r.rowCount; }
    }

    // 3. The placeholder vehicles are now unreferenced, so they can go.
    for (const v of placeholders) {
      await c.query("delete from vehicles where id = $1", [v.id]);
      console.log(`   deleted vehicle ${v.plate}`);
    }

    await c.query("delete from customers where id = $1", [id]);
    console.log(`   deleted duplicate customer`);
  }

  // Prove it: one Lucas, one car, and the quote on the real plate.
  const left = await c.query("select id, name from customers where name ilike '%lutchmoodoo%'");
  const cars = await c.query("select plate from vehicles where customer_id = $1", [KEEP]);
  const docs = await c.query(
    `select d.number, d.status, v.plate from documents d left join vehicles v on v.id = d.vehicle_id
      where d.customer_id = $1 order by d.created_at`, [KEEP],
  );
  const jobs = await c.query(
    `select j.status, v.plate from jobs j left join vehicles v on v.id = j.vehicle_id where j.customer_id = $1`, [KEEP],
  );
  console.log(`\nAFTER  customers named Lucas: ${left.rowCount}   cars: ${cars.rows.map((r) => r.plate).join(", ")}`);
  console.log("       documents:", docs.rows.map((d) => `${d.number ?? "draft"}/${d.status}@${d.plate ?? "—"}`).join(", ") || "(none)");
  console.log("       jobs     :", jobs.rows.map((j) => `${j.status}@${j.plate ?? "—"}`).join(", ") || "(none)");

  if (left.rowCount !== 1) throw new Error(`expected exactly 1 Lucas, found ${left.rowCount} — rolling back`);
  if (docs.rows.some((d) => d.plate === "NIL" || d.plate === null)) throw new Error("a document is still on a placeholder plate — rolling back");
  if (jobs.rows.some((j) => j.plate === "NIL" || j.plate === null)) throw new Error("a job is still on a placeholder plate — rolling back");

  if (COMMIT) {
    await c.query("COMMIT");
    console.log(`\n✓ COMMITTED — ${moved} rows moved onto the keeper.`);
  } else {
    await c.query("ROLLBACK");
    console.log(`\nDRY RUN — rolled back, nothing written. ${moved} rows would move. Re-run with --commit.`);
  }
} catch (e) {
  await c.query("ROLLBACK");
  console.error("\n✗ FAILED, rolled back:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
