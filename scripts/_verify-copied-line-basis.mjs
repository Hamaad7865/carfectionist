// Rolled-back proof for 20260813000010: a copied line keeps its price basis.
//   1) every copy RPC's live def now carries price_includes_vat
//   2) convert_quote_to_invoice(TESTQ-00033) → the SILVER line lands on 1,759.99 incl, flag intact
//   3) duplicate_document(quote) → same
// Everything runs as the sandbox owner inside one transaction and ROLLS BACK.
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";
import { SANDBOX_TENANT } from "./_sandbox.mjs";
requireEnv("SUPABASE_DB_URL", DB_URL);
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

let pass = true;
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  pass = pass && ok;
  console.log(`${ok ? "GOOD" : "BAD "}  ${name}: got ${got}${ok ? "" : `, want ${want}`}`);
};

// 1) live defs carry the flag
const fns = await c.query(`
  select p.proname, (pg_get_functiondef(p.oid) like '%price_includes_vat%') carries
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in ('convert_quote_to_invoice','create_and_issue_credit_note','duplicate_document','revise_quote')`);
for (const f of fns.rows) check(`${f.proname} carries the flag`, f.carries, true);

const owner = await c.query(
  `select auth_user_id from public.app_users where tenant_id=$1 and role='owner' limit 1`, [SANDBOX_TENANT]);
const quote = await c.query(
  `select id from public.documents where tenant_id=$1 and number='TESTQ-00033'`, [SANDBOX_TENANT]);
const qid = quote.rows[0]?.id;

try {
  await c.query("begin");

  // Billing is bill-once: while the (wrong) draft from before the fix exists, convert
  // just returns it. Clear it INSIDE the rolled-back tx, before dropping to the owner
  // role (RLS has no draft-delete path for this probe; the superuser does, and it all
  // rolls back). Lines ride the FK cascade.
  await c.query(
    `delete from public.documents where tenant_id=$1 and source_document_id=$2 and status='draft'`,
    [SANDBOX_TENANT, qid]);

  await c.query(`select set_config('role','authenticated', true)`);
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: owner.rows[0].auth_user_id, role: "authenticated" })]);

  // 2) bill the accepted quote again — the exact path that produced 2,023.99
  const conv = await c.query(`select id from public.convert_quote_to_invoice($1)`, [qid]);
  const invLine = await c.query(
    `select price_includes_vat piv, unit_price::text unit, (line_total_excl + line_vat)::text incl
     from public.document_lines where document_id=$1 and title ilike '%SILVER%'`, [conv.rows[0].id]);
  check("converted invoice line keeps the flag", invLine.rows[0].piv, true);
  check("converted invoice line incl", invLine.rows[0].incl, "1759.99");

  // 3) duplicate the quote — same copy shape
  const dup = await c.query(`select id from public.duplicate_document($1)`, [qid]);
  const dupLine = await c.query(
    `select price_includes_vat piv, (line_total_excl + line_vat)::text incl
     from public.document_lines where document_id=$1 and title ilike '%SILVER%'`, [dup.rows[0].id]);
  check("duplicated quote line keeps the flag", dupLine.rows[0].piv, true);
  check("duplicated quote line incl", dupLine.rows[0].incl, "1759.99");
} catch (e) {
  pass = false;
  console.error("✗ probe failed:", e.message);
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(`\n${pass ? "✓ ALL GOOD — a copied line keeps its price basis." : "✗ SOMETHING IS STILL WRONG — do not ship."}`);
process.exitCode = pass ? 0 : 1;
