// One-off: bring the two stored Z reports of 2026-10-05 (Z000098 service, Z000099 day)
// in line with the Sales Journal after CN-0004 was voided on 2026-10-12.
//
// The stored totals are frozen at close and z_reports is append-only. This re-reads
// app.z_totals AS AT each Z's own closing instant (so nothing that happened later can
// leak in), lays the fresh figures over the stored ones key by key — everything the
// close itself recorded (counted cash, floats, variance, service numbers) is kept — and
// moves the Juice remittance by the same amount the Juice takings moved.
//
// Default is a DRY RUN: one BEGIN/ROLLBACK that loads the z_totals migration if it is
// not installed yet, prints every leaf that would change, and persists nothing.
//
//   node scripts/_fix-z-5oct-voided-credit-note.mjs            # dry run
//   node scripts/_fix-z-5oct-voided-credit-note.mjs --apply    # write (migration must be installed)
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const APPLY = process.argv.includes("--apply");
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = "supabase/migrations/20261013000010_z_ignores_a_voided_credit_notes_refund.sql";

const TENANT = "11111111-1111-4111-8111-000000000001";
const SESSION = "c2fed946-dbc0-4478-85d3-312a450e828d";
const DAY = "82bda989-1a93-438e-9225-c34392d77153";
const CN = "40505f81-742e-45ee-aca7-b113af01e9f8";
const ACTOR = "7c6e5d33-b296-4acb-8dac-eb02cddb3d51"; // Hamaad Boodoo (owner) — asked for this
const Z_SERVICE = "c991fa2b-bea4-4041-b098-56079d3c789d"; // Z000098
const Z_DAY = "2bfa8c33-3e80-4b15-896c-84b98def031c"; // Z000099

const flatten = (v, path = "", out = {}) => {
  if (v !== null && typeof v === "object") {
    const keyOf = (item, i) => (item && typeof item === "object" && (item.method ?? item.name ?? item.rate) !== undefined ? `[${item.method ?? item.name ?? item.rate}]` : `[${i}]`);
    if (Array.isArray(v)) v.forEach((item, i) => flatten(item, path + keyOf(item, i), out));
    else for (const k of Object.keys(v)) flatten(v[k], path ? `${path}.${k}` : k, out);
  } else out[path] = v;
  return out;
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
let failed = false;
try {
  await c.query("begin");

  const installed = (await c.query(
    `select pg_get_functiondef(p.oid) ~ 'vd.status = ''void''' as ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'z_totals'`,
  )).rows[0].ok;
  if (!installed) {
    if (APPLY) throw new Error("the z_totals migration is not installed — run `npm run db:push` first");
    await c.query(readFileSync(resolve(__dirname, "..", MIGRATION), "utf8"));
    console.log("· z_totals migration loaded inside this transaction (dry run only)");
  }

  const cn = (await c.query("select number, status from public.documents where id = $1", [CN])).rows[0];
  if (cn?.status !== "void") throw new Error(`CN-0004 is ${cn?.status}, not void — nothing to align`);

  const stored = (await c.query(
    "select id, number, scope, totals, md5(totals::text) as hash from public.z_reports where id = any($1) order by number",
    [[Z_SERVICE, Z_DAY]],
  )).rows;
  if (stored.length !== 2) throw new Error(`expected 2 Z reports, found ${stored.length}`);

  // The patch, in SQL so the numbers never pass through JS floats.
  const PATCH = `
    with z as (select id, scope, totals, (totals->>'as_at')::timestamptz as as_at from public.z_reports where id = $1),
    fresh as (
      select z.*,
             app.z_totals($2, $3, null, z.as_at) as svc,
             app.z_totals($2, null, $4, z.as_at) as dy
        from z
    ),
    juice as (
      select f.*,
             coalesce((select (m->>'net')::numeric from jsonb_array_elements(f.svc->'methods') m where m->>'method' = 'juice'), 0)
           - coalesce((select (m->>'net')::numeric from jsonb_array_elements(f.totals->'services'->0->'methods') m where m->>'method' = 'juice'), 0) as delta
        from fresh f
    )
    select case when scope = 'service' then
             (totals || svc)
               || jsonb_build_object('period', (totals->'period') || dy)
               || jsonb_build_object('services', jsonb_build_array((totals->'services'->0) || svc))
               || jsonb_build_object('remittances', (
                    select jsonb_agg(case when r->>'method' = 'juice' then r || jsonb_build_object('amount', (r->>'amount')::numeric + delta) else r end)
                      from jsonb_array_elements(totals->'remittances') r))
               || jsonb_build_object('accumulation', (
                    select jsonb_agg(case when a->>'method' = 'juice'
                                          then a || jsonb_build_object('takings', (a->>'takings')::numeric + delta, 'remitted', (a->>'remitted')::numeric + delta)
                                          else a end)
                      from jsonb_array_elements(totals->'accumulation') a))
           else
             (totals || dy)
               || jsonb_build_object('services', jsonb_build_array((totals->'services'->0) || svc))
           end as patched,
           delta
      from juice`;

  const updates = [];
  for (const z of stored) {
    if (z.totals.services?.length !== 1) throw new Error(`${z.number}: expected exactly one service block`);
    const { patched, delta } = (await c.query(PATCH, [z.id, TENANT, SESSION, DAY])).rows[0];
    const before = flatten(z.totals);
    const after = flatten(patched);
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    const changed = keys.filter((k) => before[k] !== after[k]);
    console.log(`\n▸ ${z.number} (${z.scope}) — Juice moves by ${delta}; ${changed.length} of ${keys.length} values change`);
    for (const k of changed) console.log(`    ${k}: ${before[k] ?? "—"} → ${after[k] ?? "—"}`);
    // Nothing the close itself recorded may move.
    const frozen = changed.filter((k) => /(counted_cash|float_|variance|expected_cash|service_no|opened_at|closed_at|as_at|device|business_date|\[cash\]|\[card\])/.test(k));
    if (frozen.length) throw new Error(`${z.number}: values the close recorded would change — ${frozen.join(", ")}`);
    updates.push({ z, patched });
  }

  if (APPLY) {
    await c.query("alter table public.z_reports disable trigger trg_z_reports_append_only");
    for (const { z, patched } of updates) {
      const r = await c.query(
        "update public.z_reports set totals = $1::jsonb where id = $2 and md5(totals::text) = $3",
        [JSON.stringify(patched), z.id, z.hash],
      );
      if (r.rowCount !== 1) throw new Error(`${z.number}: expected to update 1 row, updated ${r.rowCount}`);
      await c.query(
        `insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
         values ($1, $2, 'z_report_corrected', 'z_report', $3, $4::jsonb)`,
        [TENANT, ACTOR, z.id, JSON.stringify({
          number: z.number,
          reason: "CN-0004 was raised by mistake and voided on 2026-10-12; the Z is brought in line with the Sales Journal",
          totals_before: z.totals,
          via: "scripts/_fix-z-5oct-voided-credit-note.mjs, requested by the owner",
        })],
      );
    }
    await c.query("alter table public.z_reports enable trigger trg_z_reports_append_only");
    const on = (await c.query(
      "select tgenabled from pg_trigger where tgrelid = 'public.z_reports'::regclass and tgname = 'trg_z_reports_append_only'",
    )).rows[0].tgenabled;
    if (on !== "O") throw new Error("the append-only trigger did not come back on");
    await c.query("commit");
    console.log("\nAPPLIED — both Z reports updated, the lock is back on, the old totals are in audit_events.");
  } else {
    await c.query("rollback");
    console.log("\nDRY RUN — nothing persisted.");
  }
} catch (e) {
  failed = true;
  await c.query("rollback").catch(() => {});
  console.error("\nFAILED — rolled back:", e.message);
} finally {
  await c.end();
}
process.exit(failed ? 1 : 0);
