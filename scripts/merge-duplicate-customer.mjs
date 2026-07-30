// Merge a duplicate customer record into the one that is actually in use.
//
// This keeps happening (four "Lucas Lutchmoodoo", then two "Yan Toinette"), and the shape is
// always the same: staff cannot see the customer they made moments ago, make them again, hit
// the unique-plate rejection on the car, and get past it by typing a plate that is not the
// real one — "NIL", "Y58 *". The live quote and job then sit on the DUPLICATE, against a car
// whose plate is wrong, while the correct plate is held by an abandoned record.
//
// So the keeper is the record carrying the WORK, not the one carrying the right plate. The
// plate is moved onto the keeper's car; the abandoned record and its car are removed.
//
//   node scripts/merge-duplicate-customer.mjs --keep <uuid> --drop <uuid>            # dry run
//   node scripts/merge-duplicate-customer.mjs --keep <uuid> --drop <uuid> --plate Y58 --commit
//
// --plate is optional: give it when the keeper's car carries a workaround plate that should be
// corrected to the real one. The drop record's car is deleted first, which is what frees it
// (vehicles_active_plate_key only constrains ACTIVE rows).
//
// Nothing is written without --commit, and a snapshot of every affected row is saved first.
import pg from "pg";
import { writeFileSync } from "node:fs";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const COMMIT = process.argv.includes("--commit");
const KEEP = arg("keep");
const DROP = arg("drop");
const PLATE = arg("plate");
if (!KEEP || !DROP) {
  console.error("usage: --keep <uuid> --drop <uuid> [--plate <real plate>] [--commit]");
  process.exit(1);
}
if (KEEP === DROP) { console.error("--keep and --drop are the same record"); process.exit(1); }

// Every table that points at a customer or a vehicle, and the column it uses. Anything missed
// here would fail on its foreign key rather than silently orphan, but the point is to move the
// history rather than trip over it.
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

const c = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("BEGIN");

try {
  const keeper = (await c.query("select id, name, phone from customers where id = $1", [KEEP])).rows[0];
  const dropped = (await c.query("select id, name, phone from customers where id = $1", [DROP])).rows[0];
  if (!keeper) throw new Error("the --keep record does not exist — re-check the ids");
  if (!dropped) throw new Error("the --drop record does not exist — it may already be merged");

  // Guard against merging two different people on a mistyped id. Same phone, or one name
  // contained in the other, is the signal; anything else has to be forced deliberately.
  const norm = (s) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const samePhone = keeper.phone && keeper.phone === dropped.phone;
  const sameName = norm(keeper.name) === norm(dropped.name);
  if (!samePhone && !sameName) {
    throw new Error(`these do not look like the same person — "${keeper.name}" vs "${dropped.name}", different phones. Refusing.`);
  }

  const keeperWork = {};
  const droppedWork = {};
  for (const [t, col] of CUSTOMER_REFS) {
    keeperWork[t] = (await c.query(`select count(*)::int n from ${t} where ${col} = $1`, [KEEP])).rows[0].n;
    droppedWork[t] = (await c.query(`select count(*)::int n from ${t} where ${col} = $1`, [DROP])).rows[0].n;
  }
  const totalDropped = Object.values(droppedWork).reduce((a, b) => a + b, 0);

  console.log(`KEEP  ${keeper.name} (${keeper.phone ?? "no phone"})  ${KEEP.slice(0, 8)}`);
  console.log(`DROP  ${dropped.name} (${dropped.phone ?? "no phone"})  ${DROP.slice(0, 8)}`);
  console.log(`      history on the dropped record: ${totalDropped} row(s)` +
    (totalDropped ? " — will be moved onto the keeper" : " — nothing to move"));

  const keeperCars = (await c.query("select * from vehicles where customer_id = $1 order by created_at", [KEEP])).rows;
  const dropCars = (await c.query("select * from vehicles where customer_id = $1 order by created_at", [DROP])).rows;
  console.log(`      keeper's cars : ${keeperCars.map((v) => v.plate).join(", ") || "none"}`);
  console.log(`      dropped cars  : ${dropCars.map((v) => v.plate).join(", ") || "none"}`);

  const snapshot = { keeper, dropped, keeperCars, dropCars, droppedWork, plate: PLATE };
  const stamp = (await c.query("select to_char(now(), 'YYYYMMDD-HH24MISS') s")).rows[0].s;
  const path = `scripts/.merge-${DROP.slice(0, 8)}-${stamp}.json`;
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
  console.log(`\nsnapshot written to ${path}`);

  // 1. Move any history off the dropped record.
  for (const [t, col] of CUSTOMER_REFS) {
    if (!droppedWork[t]) continue;
    const r = await c.query(`update ${t} set ${col} = $1 where ${col} = $2`, [KEEP, DROP]);
    console.log(`  moved ${r.rowCount} ${t} row(s)`);
  }

  // 2. Its cars: unreferenced ones go (that is what frees the plate); referenced ones move.
  for (const v of dropCars) {
    let refs = 0;
    for (const [t, col] of VEHICLE_REFS) {
      refs += (await c.query(`select count(*)::int n from ${t} where ${col} = $1`, [v.id])).rows[0].n;
    }
    if (refs === 0) {
      await c.query("delete from vehicles where id = $1", [v.id]);
      console.log(`  deleted unused car ${v.plate}`);
    } else {
      await c.query("update vehicles set customer_id = $1 where id = $2", [KEEP, v.id]);
      console.log(`  moved car ${v.plate} (${refs} reference(s)) onto the keeper`);
    }
  }

  // 3. Correct the keeper's plate, now that the duplicate is not holding it.
  if (PLATE) {
    const target = keeperCars[0];
    if (!target) throw new Error("--plate was given but the keeper has no car to correct");
    const clash = (await c.query(
      "select id, customer_id from vehicles where id <> $1 and is_active and upper(replace(plate,' ','')) = upper(replace($2,' ',''))",
      [target.id, PLATE],
    )).rows[0];
    if (clash) throw new Error(`${PLATE} is still held by vehicle ${clash.id.slice(0, 8)} — resolve that first`);
    await c.query("update vehicles set plate = $1 where id = $2", [PLATE, target.id]);
    console.log(`  corrected the keeper's plate: ${target.plate} -> ${PLATE}`);
  }

  // 4. The duplicate person goes.
  await c.query("delete from customers where id = $1", [DROP]);
  console.log(`  deleted the duplicate customer record`);

  // 5. Prove it before committing.
  const left = (await c.query("select count(*)::int n from customers where id = $1", [DROP])).rows[0].n;
  if (left !== 0) throw new Error("the duplicate is still there — aborting");
  for (const [t, col] of CUSTOMER_REFS) {
    const n = (await c.query(`select count(*)::int n from ${t} where ${col} = $1`, [DROP])).rows[0].n;
    if (n) throw new Error(`${n} ${t} row(s) still point at the deleted record — aborting`);
  }
  const finalCars = (await c.query("select plate from vehicles where customer_id = $1 order by created_at", [KEEP])).rows;
  console.log(`\nkeeper now holds: ${finalCars.map((v) => v.plate).join(", ") || "no cars"}`);

  if (COMMIT) {
    await c.query("COMMIT");
    console.log("COMMITTED.");
  } else {
    await c.query("ROLLBACK");
    console.log("DRY RUN — rolled back. Re-run with --commit to apply.");
  }
} catch (e) {
  await c.query("ROLLBACK");
  console.error(`\nROLLED BACK: ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
