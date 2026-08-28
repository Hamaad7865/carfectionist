// Dry-run for "walk-in customers cannot earn or hold loyalty points"
// (20260828000010 + 20260828000020). One BEGIN … ROLLBACK — nothing persists.
//
// Proves:
//   GUARD   app.award_points_for_invoice earns nothing for a customer with no
//           phone and no email; still earns for one with a phone.
//   SPEND   app.spend_points raises "not on the loyalty programme" for a
//           no-contact customer.
//   CLEANUP the compensating 'adjusted' entries zero every anonymous balance.
//
//   node scripts/_verify-anon-customer-no-points.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const __dirname = dirname(fileURLToPath(import.meta.url));
const mig = (f) => readFileSync(resolve(__dirname, "..", "supabase/migrations", f), "utf8");
const GUARD = mig("20260828000010_points_need_a_reachable_customer.sql");
const CLEANUP = mig("20260828000020_zero_anonymous_customer_points.sql");
const OWNER_AUTH_UID = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner)

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
let ok = true;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) ok = false;
};
const expectError = async (name, fn, needle) => {
  await c.query("savepoint s");
  try {
    await fn();
    check(name, false, "no error was raised");
  } catch (e) {
    check(name, e.message.includes(needle), e.message.slice(0, 120));
  }
  await c.query("rollback to savepoint s");
};
const earnRows = async (invId) =>
  Number(
    (
      await c.query(
        `select count(*)::int n from public.customer_points_ledger
          where ref_type='document' and ref_id=$1 and reason='earned'`,
        [invId],
      )
    ).rows[0].n,
  );

try {
  await c.query("begin");
  await c.query(GUARD);
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: OWNER_AUTH_UID, role: "authenticated" }),
  ]);
  const tenant = (await c.query(`select app.current_tenant_id() t`)).rows[0].t;
  // Earning also needs the programme on and a rate — isolate the reachability guard.
  await c.query(
    `update public.business_settings set points_enabled = true, points_per_100 = 1 where id = $1`,
    [tenant],
  );

  const pick = async (reachable) =>
    (
      await c.query(
        `select d.id, d.number, c.name, c.phone, c.email
           from public.documents d
           join public.customers c on c.id = d.customer_id
          where d.doc_type='invoice' and d.total_incl > 0
            and d.status in ('issued','partly_paid','paid')
            and (nullif(btrim(c.phone),'') is ${reachable ? "not null" : "null"}
                 ${reachable ? "or" : "and"} nullif(btrim(c.email),'') is ${reachable ? "not null" : "null"})
            and not exists (
              select 1 from public.customer_points_ledger l
               where l.ref_type='document' and l.ref_id=d.id and l.reason='earned')
          order by d.created_at desc
          limit 1`,
      )
    ).rows[0];

  const anon = await pick(false);
  const named = await pick(true);
  if (!anon || !named) {
    console.log(`⚠ need one un-earned invoice for each kind (anon=${!!anon} named=${!!named})`);
    process.exit(1);
  }
  console.log(`anon  invoice ${anon.number} → "${anon.name}" (no phone/email)`);
  console.log(`named invoice ${named.number} → "${named.name}" (${named.phone ?? named.email})`);

  // ── GUARD: award ─────────────────────────────────────────────────────────
  console.log("\n— app.award_points_for_invoice —");
  await c.query(`select app.award_points_for_invoice($1)`, [anon.id]);
  check("no-contact customer earns NOTHING", (await earnRows(anon.id)) === 0);
  await c.query(`select app.award_points_for_invoice($1)`, [named.id]);
  check("reachable customer still earns", (await earnRows(named.id)) === 1);

  // ── GUARD: spend ────────────────────────────────────────────────────────
  console.log("\n— app.spend_points —");
  await expectError(
    "no-contact customer cannot spend points",
    () => c.query(`select app.spend_points($1, 1.00, gen_random_uuid())`, [anon.id]),
    "not on the loyalty programme",
  );

  // ── CLEANUP ────────────────────────────────────────────────────────────
  console.log("\n— 20260828000020 cleanup —");
  const before = (
    await c.query(
      `select count(*)::int n, coalesce(sum(points_balance),0)::int pts
         from public.customers
        where points_balance <> 0 and nullif(btrim(phone),'') is null and nullif(btrim(email),'') is null`,
    )
  ).rows[0];
  const adjBefore = (
    await c.query(
      `select count(*)::int n from public.customer_points_ledger
        where reason='adjusted' and note like 'Anonymous customer%'`,
    )
  ).rows[0].n;
  await c.query(CLEANUP);
  const after = (
    await c.query(
      `select count(*)::int n from public.customers
        where points_balance <> 0 and nullif(btrim(phone),'') is null and nullif(btrim(email),'') is null`,
    )
  ).rows[0];
  const adjNew = (
    await c.query(
      `select count(*)::int n, coalesce(sum(delta),0)::int pts
         from public.customer_points_ledger where reason='adjusted' and note like 'Anonymous customer%'`,
    )
  ).rows[0];
  // Adapts whether or not the migration has already run against this DB: if there
  // was a balance to zero, exactly that many compensating rows appear; if the DB
  // is already clean, the cleanup is a verified no-op.
  check(
    before.n > 0
      ? `${before.n} anonymous balance(s) (${before.pts} pts) → 0`
      : "already clean — cleanup is a no-op",
    after.n === 0 &&
      adjNew.n - adjBefore === before.n &&
      (before.n === 0 || adjNew.pts <= -before.pts),
    `new adjusted rows=${adjNew.n - adjBefore}`,
  );

  await c.query("rollback");
  console.log(`\n${ok ? "PASS" : "FAIL"} — transaction rolled back, nothing persisted.`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("✗ dry-run error:", e.message);
  process.exit(1);
} finally {
  await c.end();
}
