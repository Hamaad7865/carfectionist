// Wipe the SANDBOX tenant back to a clean slate.
//
//   node scripts/reset-sandbox.mjs            — documents, jobs, money, tills
//   node scripts/reset-sandbox.mjs --all      — also customers, vehicles, devices
//
// This is the script that makes "undo everything I did while testing" a sentence
// anyone can say. It is only safe because the sandbox is a separate tenant: every
// delete is scoped to its tenant_id, and the guard below refuses to run against a
// company that has a BRN. A tenant with a BRN is a real business with real books,
// and no amount of arguing at this script will let you point it at one.
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";
import { SANDBOX_TENANT } from "./_sandbox.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const ALL = process.argv.includes("--all");

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

// ── the guard ───────────────────────────────────────────────────────────────
const t = (await c.query(
  "select id, legal_name, brn, vat_number, is_sandbox from public.business_settings where id = $1",
  [SANDBOX_TENANT],
)).rows[0];
if (!t) { console.error("✗ no sandbox tenant — run scripts/setup-sandbox.mjs first"); process.exit(1); }
if (!t.is_sandbox) { console.error(`✗ ${t.legal_name} is not flagged is_sandbox — refusing`); process.exit(1); }
if (t.brn || t.vat_number) { console.error(`✗ ${t.legal_name} carries a BRN/VAT number — that is a real company. Refusing.`); process.exit(1); }
console.log(`▸ wiping ${t.legal_name} (${SANDBOX_TENANT})`);

// Children before parents. Anything scoped by tenant_id is listed here; anything
// scoped only by a foreign key is deleted through its parent's tenant.
const CASCADE = [
  ["payments", "tenant_id"],
  ["document_lines", "tenant_id"],
  ["stock_movements", "tenant_id"],
  ["scheduled_sends", "tenant_id"],
  ["audit_events", "tenant_id"],
  ["job_technicians", null],          // via jobs
  ["documents", "tenant_id"],
  ["jobs", "tenant_id"],
  ["cash_sessions", "tenant_id"],
  ["trading_days", "tenant_id"],
  ["idempotency_keys", "tenant_id"],
];

try {
  await c.query("begin");

  // job_technicians has no tenant_id of its own — reach it through its jobs.
  await c.query(
    `delete from public.job_technicians where job_id in (select id from public.jobs where tenant_id = $1)`,
    [SANDBOX_TENANT],
  ).catch(() => {});

  let total = 0;
  for (const [table, col] of CASCADE) {
    if (!col) continue;
    const r = await c.query(`delete from public.${table} where ${col} = $1`, [SANDBOX_TENANT]).catch((e) => {
      console.log(`  – ${table}: skipped (${e.message.split("\n")[0]})`);
      return null;
    });
    if (r) { total += r.rowCount; if (r.rowCount) console.log(`  ${String(r.rowCount).padStart(5)}  ${table}`); }
  }

  if (ALL) {
    for (const table of ["vehicles", "customers", "devices"]) {
      const r = await c.query(`delete from public.${table} where tenant_id = $1`, [SANDBOX_TENANT]).catch(() => null);
      if (r?.rowCount) { total += r.rowCount; console.log(`  ${String(r.rowCount).padStart(5)}  ${table}`); }
    }
  }

  // Numbering starts over, so a fresh rehearsal reads TESTQ-1 again rather than
  // carrying the scars of the last one.
  await c.query(
    `update public.business_settings
        set quote_next_number = 1, invoice_next_number = 1, credit_note_next_number = 1, z_next_number = 1
      where id = $1`, [SANDBOX_TENANT],
  );

  await c.query("commit");
  console.log(`\n✓ ${total} rows removed. Numbering back to 1.`);
  console.log(ALL ? "  Customers and vehicles went too — re-run setup-sandbox.mjs to put the test customer back."
                  : "  Catalogue, customers and the login were left alone (--all removes those too).");
} catch (e) {
  await c.query("rollback");
  console.error("✗ failed, nothing removed:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
