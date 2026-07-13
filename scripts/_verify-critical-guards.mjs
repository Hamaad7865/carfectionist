// Rolled-back check for 20260713000002_critical_path_guards.sql: apply the
// migration inside a transaction, confirm the two functions replace cleanly and
// carry the new guards, then ROLL BACK. Nothing persists.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);

let failures = 0;
const check = (label, cond) => { if (!cond) failures++; console.log(`  ${cond ? "✓" : "✗"} ${label}`); };

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260713000002_critical_path_guards.sql"), "utf8");
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");
  console.log("▸ apply migration in-tx");
  await c.query(migration);
  console.log("  ✓ applied without error (functions replaced)");

  const inv = (await c.query("select pg_get_functiondef('public.convert_quote_to_invoice(uuid)'::regprocedure) d")).rows[0].d;
  check("convert_quote_to_invoice: dead-quote status guard present", /cannot invoice a % quote/.test(inv));
  check("convert_quote_to_invoice: matches job-path invoice (job_id)", /job_id = v_q\.job_id/.test(inv));

  const cjfd = (await c.query("select pg_get_functiondef('public.create_job_from_document(uuid)'::regprocedure) d")).rows[0].d;
  check("create_job_from_document: stamps source_quote_id for quotes", /source_quote_id/.test(cjfd) && /v_doc\.doc_type = 'quote'/.test(cjfd));

  // Sanity: the function still runs (rejects a missing quote through the new code path).
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: "0eb870dc-ef5b-400a-8744-859c999a1b1b", role: "authenticated" })]);
  try {
    await c.query("savepoint s1");
    await c.query("select public.convert_quote_to_invoice('00000000-0000-0000-0000-000000000000')");
    check("convert rejects a missing quote", false);
  } catch (e) {
    await c.query("rollback to savepoint s1");
    check("convert rejects a missing quote", /quote not found/.test(e.message));
  }
} catch (e) {
  failures++;
  console.error("✗ error:", e.message);
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(failures === 0 ? "\n✓ all checks passed (rolled back)" : `\n✗ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
