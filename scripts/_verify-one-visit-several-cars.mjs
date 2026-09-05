// Verifies 20260905000020_one_visit_several_cars.sql against the LIVE DB, all of it
// inside ONE BEGIN/ROLLBACK — the migration is loaded inside the txn, so neither the
// new functions nor a single test row survive. Nothing here can reach a real customer.
//
//   A. THE ORDINARY QUOTE — one car still takes the old path: one job, one invoice,
//      the header vehicle unchanged. This is the regression that matters most.
//   B. THREE CARS, ONE QUOTE — save_draft attributes each line to its car, the header
//      names the first car (never null), app.document_cars sees three.
//   C. ACCEPT → THREE JOBS — one per car, each with ITS OWN damage markers out of the
//      per-car intake shape, all linked to the one quote. A second call returns the
//      same three (idempotent under a double-tap).
//   D. ONE INVOICE — every line keeps its car, and the bill claims all three jobs
//      through document_jobs, so no car reads as never-invoiced.
//   E. THE OLD SHAPE STILL LANDS — a legacy {markers,photos} intake reaches its job.
//   F. GUARDS — a line naming another customer's car is refused; create_job_from_document
//      delegates instead of putting one car on the board and losing two.
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import pg from "pg";
config({ path: ".env" });

const TENANT = "11111111-1111-4111-8111-000000000001";
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh's AUTH uid — goes in JWT claims
const MIGRATION = "supabase/migrations/20260905000020_one_visit_several_cars.sql";
let APP_USER;

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL.trim(), ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};
const asOwner = () =>
  c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" })]);

const marker = (x) => [{ x, y: x, type: "scratch" }];

try {
  ({ rows: [{ id: APP_USER }] } = await c.query(
    `select id from public.app_users where tenant_id = $1 and role = 'owner' limit 1`, [TENANT]));

  await c.query("begin");
  await asOwner();
  await c.query(readFileSync(MIGRATION, "utf8"));
  console.log("→ migration loaded inside the txn\n");

  // A throwaway customer with three cars, and a second customer with one.
  const { rows: [cust] } = await c.query(
    `insert into public.customers (tenant_id, name, phone) values ($1, 'ZZ Probe Yogen', '5000 0000') returning id`, [TENANT]);
  const { rows: [other] } = await c.query(
    `insert into public.customers (tenant_id, name) values ($1, 'ZZ Probe Someone Else') returning id`, [TENANT]);
  const cars = [];
  for (const plate of ["ZZ PROBE 1", "ZZ PROBE 2", "ZZ PROBE 3"]) {
    const { rows: [v] } = await c.query(
      `insert into public.vehicles (tenant_id, customer_id, plate, make) values ($1, $2, $3, 'Probe') returning id`,
      [TENANT, cust.id, plate]);
    cars.push(v.id);
  }
  const { rows: [otherCar] } = await c.query(
    `insert into public.vehicles (tenant_id, customer_id, plate) values ($1, $2, 'ZZ OTHER 9') returning id`,
    [TENANT, other.id]);

  const line = (title, price, vehicle_id, sort) =>
    ({ title, qty: 1, unit_price: price, vat_rate: 15, sort_order: sort, line_kind: "service", vehicle_id });

  // ── A. the ordinary one-car quote is untouched ────────────────────────────
  const { rows: [oneCar] } = await c.query(
    `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "quote", customer_id: cust.id, vehicle_id: cars[0],
                      intake: { cars: [{ vehicle_id: cars[0], markers: marker(10), photos: [] }] } }),
     JSON.stringify([line("Full detail", 3000, cars[0], 0)])]);
  check("A1 one car → header keeps that car", oneCar.vehicle_id === cars[0]);
  const { rows: oneCarCars } = await c.query(`select * from app.document_cars($1)`, [oneCar.id]);
  check("A2 document_cars sees exactly one", oneCarCars.length === 1, `${oneCarCars.length}`);
  const { rows: oneJobs } = await c.query(
    `select * from public.convert_quote_to_jobs($1, null, null, null)`, [oneCar.id]);
  check("A3 one car → ONE job (delegated to the old path)", oneJobs.length === 1, `${oneJobs.length} jobs`);
  check("A4 that job carries the car's markers", JSON.stringify(oneJobs[0]?.damage_markers) === JSON.stringify(marker(10)),
    JSON.stringify(oneJobs[0]?.damage_markers));

  // ── B. three cars on one quote ────────────────────────────────────────────
  const intake = { cars: cars.map((v, i) => ({ vehicle_id: v, markers: marker(20 + i), photos: [] })) };
  const { rows: [q] } = await c.query(
    `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "quote", customer_id: cust.id, intake }),
     JSON.stringify([
       line("Full detail — car 1", 5000, cars[0], 0),
       line("Wax — car 1", 1000, cars[0], 1),
       line("Full detail — car 2", 4000, cars[1], 2),
       line("Interior — car 3", 2500, cars[2], 3),
       line("Air freshener", 200, null, 4),   // no car: a counter product
     ])]);
  check("B1 header names the FIRST car, never null", q.vehicle_id === cars[0], String(q.vehicle_id));
  const { rows: qCars } = await c.query(`select * from app.document_cars($1) order by ord`, [q.id]);
  check("B2 document_cars sees three, in line order", qCars.length === 3 &&
    qCars.map((r) => r.vehicle_id).join() === cars.join(), qCars.map((r) => r.vehicle_id).join());
  const { rows: [{ total }] } = await c.query(
    `select total_incl as total from public.documents where id = $1`, [q.id]);
  check("B3 totals unchanged by grouping", Number(total) === Math.round(12700 * 1.15 * 100) / 100, `Rs ${total}`);

  // ── C. accept → three jobs, each with its own condition ───────────────────
  const { rows: jobs } = await c.query(
    `select * from public.convert_quote_to_jobs($1, null, null, $2::jsonb)`,
    [q.id, JSON.stringify({ name: "Yogen", signature_path: null })]);
  check("C1 three cars → THREE jobs", jobs.length === 3, `${jobs.length} jobs`);
  check("C2 one job per car, in line order",
    jobs.map((j) => j.vehicle_id).sort().join() === [...cars].sort().join());
  const perCar = Object.fromEntries(jobs.map((j) => [j.vehicle_id, JSON.stringify(j.damage_markers)]));
  check("C3 each job got ITS OWN markers", cars.every((v, i) => perCar[v] === JSON.stringify(marker(20 + i))),
    JSON.stringify(perCar));
  const { rows: [acc] } = await c.query(`select status, number, accepted_signature from public.documents where id = $1`, [q.id]);
  check("C4 the quote is accepted and numbered", acc.status === "accepted" && !!acc.number, `${acc.status} ${acc.number}`);
  const { rows: again } = await c.query(
    `select * from public.convert_quote_to_jobs($1, null, null, null)`, [q.id]);
  check("C5 a second tap returns the SAME three", again.length === 3 &&
    again.map((j) => j.id).sort().join() === jobs.map((j) => j.id).sort().join(), `${again.length}`);

  // ── D. one invoice, every car ─────────────────────────────────────────────
  const { rows: [inv] } = await c.query(`select * from public.convert_quote_to_invoice($1)`, [q.id]);
  const { rows: invLines } = await c.query(
    `select title, vehicle_id from public.document_lines where document_id = $1 order by sort_order`, [inv.id]);
  check("D1 the bill has all five lines", invLines.length === 5, `${invLines.length}`);
  check("D2 every line kept its car", invLines.slice(0, 4).every((l, i) =>
    l.vehicle_id === [cars[0], cars[0], cars[1], cars[2]][i]) && invLines[4].vehicle_id === null);
  const { rows: linked } = await c.query(`select job_id from public.document_jobs where document_id = $1`, [inv.id]);
  check("D3 the bill claims all THREE jobs", linked.length === 3 &&
    linked.map((r) => r.job_id).sort().join() === jobs.map((j) => j.id).sort().join(), `${linked.length} linked`);
  const { rows: [inv2] } = await c.query(`select * from public.convert_quote_to_invoice($1)`, [q.id]);
  check("D4 billing again returns the same bill", inv2.id === inv.id);
  const { rows: [issued] } = await c.query(
    `select * from public.issue_document($1, null, $2, null)`, [inv.id, `probe:${inv.id}`]);
  check("D5 the multi-car bill ISSUES (number + fiscal snapshot)", !!issued.number, String(issued.number));
  check("D6 issued total is the same money", Number(issued.total_incl) === Number(total), `${issued.total_incl}`);

  // ── E. the old single-car intake shape still lands ────────────────────────
  const { rows: [legacy] } = await c.query(
    `insert into public.documents (tenant_id, doc_type, status, customer_id, vehicle_id, intake, created_by, origin)
     values ($1,'quote','draft',$2,$3,$4::jsonb,$5,'standalone') returning id`,
    [TENANT, cust.id, cars[1], JSON.stringify({ markers: marker(77), photos: [] }), APP_USER]);
  await c.query(
    `insert into public.document_lines (tenant_id, document_id, title, qty, unit_price, vat_rate, sort_order)
     values ($1,$2,'Legacy line',1,900,15,0)`, [TENANT, legacy.id]);
  const { rows: legacyJobs } = await c.query(
    `select * from public.convert_quote_to_jobs($1, null, null, null)`, [legacy.id]);
  check("E1 legacy intake → one job", legacyJobs.length === 1);
  check("E2 legacy markers still reach the job",
    JSON.stringify(legacyJobs[0]?.damage_markers) === JSON.stringify(marker(77)),
    JSON.stringify(legacyJobs[0]?.damage_markers));

  // ── F. guards ─────────────────────────────────────────────────────────────
  let refused = null;
  try {
    await c.query(`savepoint sp1`);
    await c.query(`select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
      [JSON.stringify({ doc_type: "quote", customer_id: cust.id }),
       JSON.stringify([line("Someone else's car", 100, otherCar.id, 0)])]);
  } catch (e) { refused = e.message; } finally { await c.query(`rollback to savepoint sp1`); }
  check("F1 a line naming another customer's car is refused", !!refused, refused ?? "IT WAS ACCEPTED");

  const { rows: [q2] } = await c.query(
    `select * from public.save_draft($1::jsonb, $2::jsonb, null)`,
    [JSON.stringify({ doc_type: "quote", customer_id: cust.id, intake }),
     JSON.stringify([line("Detail", 1000, cars[0], 0), line("Detail", 1000, cars[1], 1)])]);
  await c.query(`select * from public.create_job_from_document($1)`, [q2.id]);
  const { rows: q2jobs } = await c.query(`select id from public.jobs where source_quote_id = $1`, [q2.id]);
  check("F2 create_job_from_document delegates — two cars, TWO jobs", q2jobs.length === 2, `${q2jobs.length}`);

  const { rows: [{ n: staleFns }] } = await c.query(
    `select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname='public' and p.proname in
        ('save_draft','convert_quote_to_job','convert_quote_to_jobs','convert_quote_to_invoice',
         'create_job_from_document','create_intake_quote','create_intake_quote_cars')`);
  check("F3 no stale overloads (7 functions, 7 definitions)", staleFns === 7, `${staleFns}`);

  // ── G. reception's own entry point ────────────────────────────────────────
  const { rows: [ciq] } = await c.query(
    `select * from public.create_intake_quote_cars($1, null, null, $2::jsonb, null)`,
    [cust.id, JSON.stringify([
      { vehicle_id: cars[0], markers: marker(5), photos: [], service: "Full detail" },
      { vehicle_id: cars[2], markers: marker(6), photos: [] },
      { new_plate: "ZZ PROBE 4", new_make: "Probe", markers: [], photos: [] },
    ])]);
  const { rows: ciqCars } = await c.query(`select * from app.document_cars($1) order by ord`, [ciq.id]);
  check("G1 intake with three cars → a quote covering three", ciqCars.length === 3, `${ciqCars.length}`);
  check("G2 its header names the first car", ciq.vehicle_id === cars[0]);
  const { rows: ciqJobs } = await c.query(
    `select * from public.convert_quote_to_jobs($1, null, null, null)`, [ciq.id]);
  check("G3 that quote converts to three jobs", ciqJobs.length === 3, `${ciqJobs.length}`);
} catch (e) {
  failed = true;
  console.error("✗ threw:", e.message);
} finally {
  await c.query("rollback");
  await c.end();
  console.log(failed ? "\n✗ FAILED — nothing was written" : "\n✓ all green — rolled back, nothing was written");
  process.exitCode = failed ? 1 : 0;
}
