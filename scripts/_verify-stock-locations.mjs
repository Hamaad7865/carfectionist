// Rolled-back verification for the stock-location manager
// (20260716000080_stock_locations_manage.sql). Impersonates real staff as
// `authenticated`, then ROLLS BACK — nothing persists.
//
// The invariants worth paying for:
//   • only an owner/manager may touch a location — and NOT by writing the table
//   • exactly one default and one sales floor, always, and both live
//   • switching a location off can never strand stock
//   • a location with history is never deleted, only switched off
import pg from "pg";
import { DB_URL } from "./_env.mjs";

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};
const denied = async (label, fn, wantMsg) => {
  await c.query("savepoint s"); // a raised exception aborts the tx — fence it
  try {
    await fn();
    failures++;
    console.log(`  ✗ ${label}: ALLOWED (want denied)`);
  } catch (e) {
    const msg = String(e.message).split("\n")[0];
    const right = !wantMsg || msg.toLowerCase().includes(wantMsg.toLowerCase());
    if (!right) failures++;
    console.log(`  ${right ? "✓" : "✗"} ${label}: ${msg.slice(0, 64)}`);
  }
  await c.query("rollback to savepoint s");
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
const asUser = (authId) =>
  c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: authId, role: "authenticated" })]);

try {
  await c.query("begin");

  const staff = await c.query(
    `select auth_user_id, display_name, role::text from app_users where is_active
      and role in ('owner','technician','cashier','manager') order by (role='owner') desc`,
  );
  const owner = staff.rows.find((s) => s.role === "owner");
  const lowly = staff.rows.find((s) => s.role === "technician" || s.role === "cashier");
  if (!owner) throw new Error("no active owner to test with");
  const product = (await c.query("select id, name from products where is_stocked and is_active limit 1")).rows[0];
  const tenant = (await c.query("select tenant_id from app_users where auth_user_id=$1", [owner.auth_user_id])).rows[0].tenant_id;

  await c.query("set local role authenticated");
  await asUser(owner.auth_user_id);
  console.log(`▸ acting as ${owner.display_name} (owner)`);

  console.log("\n▸ the seeded shape survived the migration");
  const seeded = await c.query("select name, is_default, is_sales_floor, is_active from stock_locations order by is_default desc");
  check("exactly one default", seeded.rows.filter((r) => r.is_default).length, 1);
  check("exactly one sales floor", seeded.rows.filter((r) => r.is_sales_floor).length, 1);
  check("the sales floor is the Shop", seeded.rows.find((r) => r.is_sales_floor)?.name, "Shop");

  console.log("\n▸ creating Warehouse 2");
  const w2 = (await c.query("select * from public.save_stock_location(null, 'Warehouse 2')")).rows[0];
  check("created live", w2.is_active, true);
  check("not the default", w2.is_default, false);
  check("not the sales floor", w2.is_sales_floor, false);
  await denied("a duplicate name, case-insensitively", () => c.query("select public.save_stock_location(null, 'warehouse 2')"), "already a location");
  await denied("a nameless location", () => c.query("select public.save_stock_location(null, '   ')"), "needs a name");

  console.log("\n▸ renaming leaves the flags alone");
  const ren = (await c.query("select * from public.save_stock_location($1, 'Warehouse Two')", [w2.id])).rows[0];
  check("renamed", ren.name, "Warehouse Two");
  check("still live", ren.is_active, true);

  console.log("\n▸ the off-switch cannot strand stock");
  await c.query(
    `insert into stock_movements (tenant_id, product_id, location_id, qty, unit_cost, ref_type, note)
     values ($1, $2, $3, 40, 0, 'adjustment', 'verify')`,
    [tenant, product.id, w2.id],
  );
  await denied(
    `switching off a location holding 40 × ${product.name.slice(0, 18)}`,
    () => c.query("select public.save_stock_location($1, 'Warehouse Two', null, null, false)", [w2.id]),
    "strand",
  );
  // empty it, and now it may go
  await c.query(
    `insert into stock_movements (tenant_id, product_id, location_id, qty, unit_cost, ref_type, note)
     values ($1, $2, $3, -40, 0, 'adjustment', 'verify empty')`,
    [tenant, product.id, w2.id],
  );
  const off = (await c.query("select * from public.save_stock_location($1, 'Warehouse Two', null, null, false)", [w2.id])).rows[0];
  check("an emptied location switches off", off.is_active, false);
  await denied("making a switched-off location the default", () => c.query("select public.save_stock_location($1, 'Warehouse Two', true)", [w2.id]), "switch");
  await c.query("select public.save_stock_location($1, 'Warehouse Two', null, null, true)", [w2.id]);

  console.log("\n▸ exactly one default, exactly one sales floor");
  await c.query("select public.save_stock_location($1, 'Warehouse Two', true)", [w2.id]);
  const defs = await c.query("select name from stock_locations where is_default");
  check("handing the default over leaves exactly one", defs.rows.length, 1);
  check("and it is the new one", defs.rows[0].name, "Warehouse Two");
  await denied("un-setting the default outright", () => c.query("select public.save_stock_location($1, 'Warehouse Two', false)", [w2.id]), "instead of un-setting");
  await denied("switching off the default", () => c.query("select public.save_stock_location($1, 'Warehouse Two', null, null, false)", [w2.id]), "default location cannot be switched off");

  const shop = (await c.query("select * from stock_locations where is_sales_floor")).rows[0];
  await c.query("select public.save_stock_location($1, 'Warehouse Two', null, true)", [w2.id]);
  const floors = await c.query("select name from stock_locations where is_sales_floor");
  check("pointing the till elsewhere leaves exactly one floor", floors.rows.length, 1);
  check("and it is the new one", floors.rows[0].name, "Warehouse Two");
  await c.query("select public.save_stock_location($1, $2, null, true)", [shop.id, shop.name]); // hand it back

  console.log("\n▸ deleting");
  // Hand the default back to the real Warehouse first, or the delete below trips
  // the default guard instead of the history guard we are actually testing.
  const realWarehouse = (await c.query("select id, name from stock_locations where not is_default and not is_sales_floor and id <> $1", [w2.id])).rows[0];
  await c.query("select public.save_stock_location($1, $2, true)", [realWarehouse.id, realWarehouse.name]);
  check("the default is back on the real Warehouse", (await c.query("select name from stock_locations where is_default")).rows[0].name, realWarehouse.name);
  await denied("deleting a location with stock history", () => c.query("select public.delete_stock_location($1)", [w2.id]), "history");
  const fresh = (await c.query("select * from public.save_stock_location(null, 'Scratch Bay')")).rows[0];
  await c.query("select public.delete_stock_location($1)", [fresh.id]);
  const gone = await c.query("select count(*)::int n from stock_locations where id=$1", [fresh.id]);
  check("a location with no history deletes", gone.rows[0].n, 0);
  const dflt = (await c.query("select id, name from stock_locations where is_default")).rows[0];
  await denied("deleting the default", () => c.query("select public.delete_stock_location($1)", [dflt.id]), "default location cannot be deleted");

  console.log("\n▸ the door is shut");
  await denied(
    "writing the table directly, even as the owner",
    () => c.query("insert into stock_locations (tenant_id, name) values ($1, 'Backdoor')", [tenant]),
    "row-level security",
  );
  // UPDATE/DELETE with no policy do NOT raise — Postgres just makes the rows
  // invisible, so the statement succeeds against nothing. "No exception" would
  // be a false pass; the honest check is that nothing moved.
  const upd = await c.query("update stock_locations set name='Hacked' where is_default");
  check("renaming the table directly touches no rows", upd.rowCount, 0);
  const del = await c.query("delete from stock_locations where name='Warehouse Two'");
  check("deleting from the table directly touches no rows", del.rowCount, 0);
  const intact = await c.query("select count(*)::int n from stock_locations where name='Hacked'");
  check("no location was renamed behind the RPC's back", intact.rows[0].n, 0);

  if (lowly) {
    await asUser(lowly.auth_user_id);
    console.log(`\n▸ as ${lowly.display_name} (${lowly.role})`);
    await denied("creating a location", () => c.query("select public.save_stock_location(null, 'Sneaky Shed')"), "owner or manager");
    await denied("deleting one", () => c.query("select public.delete_stock_location($1)", [w2.id]), "owner or manager");
    const canRead = await c.query("select count(*)::int n from stock_locations");
    check("but can still READ locations (needed to do the job)", canRead.rows[0].n > 0, true);
  } else {
    console.log("\n▸ (no technician/cashier on file to test the role gate against)");
  }
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(failures === 0 ? "\n✓ all checks passed (rolled back)" : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
