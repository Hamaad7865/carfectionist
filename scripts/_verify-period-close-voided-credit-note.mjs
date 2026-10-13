// Verifies 20261013000020 inside ONE BEGIN/ROLLBACK on the live shop (read + rolled back).
//   · a month with no voided credit note closes to the very same totals before and after
//   · October's Juice, summed the way close_period sums it, gains CN-0004's 1,215.00
//   · the file is a no-op the second time
//   node scripts/_verify-period-close-voided-credit-note.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(resolve(__dirname, "..", "supabase/migrations/20261013000020_period_close_ignores_a_voided_credit_notes_refund.sql"), "utf8");
const TENANT = "11111111-1111-4111-8111-000000000001";
const OWNER = "de896cd7-1add-4edc-b45d-74baf152777f"; // Hamaad Boodoo (owner) — auth user id

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
let bad = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) bad++; };
const def = async () => (await c.query("select md5(pg_get_functiondef('public.close_period(text)'::regprocedure)) h")).rows[0].h;
const closeSept = async () => {
  await c.query("savepoint s");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: OWNER, role: "authenticated" })]);
  const t = (await c.query("select (public.close_period('2026-09')).totals as t")).rows[0].t;
  await c.query("rollback to savepoint s");
  return JSON.stringify(t);
};
const octJuice = async (filtered) => (await c.query(
  `select coalesce(sum(amount),0)::text s from public.payments
    where tenant_id = $1 and method = 'juice' and received_at >= '2026-10-01T00:00:00+04' and received_at < '2026-11-01T00:00:00+04'
      ${filtered ? "and not exists (select 1 from public.documents vd where vd.id = payments.document_id and vd.doc_type = 'credit_note' and vd.status = 'void')" : ""}`,
  [TENANT])).rows[0].s;
try {
  await c.query("begin");
  const found = await def();
  const installed = (await c.query("select pg_get_functiondef('public.close_period(text)'::regprocedure) ~ 'vd.id = payments.document_id' ok")).rows[0].ok;
  const before = installed ? null : await closeSept();
  await c.query(migration);
  const afterDef = await def();
  ok(installed ? afterDef === found : afterDef !== found, installed ? "already installed — loading it again changed nothing" : "the migration ran and its proof block passed");
  const after = await closeSept();
  if (before) ok(before === after, "September closes to the same totals before and after");
  else ok(after.length > 2, "September still closes");
  await c.query(migration);
  ok((await def()) === afterDef, "running the file a second time changes nothing");
  const raw = await octJuice(false), kept = await octJuice(true);
  ok(Number(kept) - Number(raw) === 1215, `October Juice so far: ${raw} with the voided refund, ${kept} without it`);
  await c.query("rollback");
  ok((await def()) === found, "ROLLED BACK — the installed function is as this run found it");
} catch (e) { bad++; await c.query("rollback").catch(() => {}); console.error("  ✗", e.message); }
finally { await c.end(); }
console.log(bad ? "\nFAIL" : "\nPASS — nothing persisted.");
process.exit(bad ? 1 : 0);
