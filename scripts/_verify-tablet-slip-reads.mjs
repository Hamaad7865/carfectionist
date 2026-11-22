// Phase G part 3a: the tablet's slip now reads which company issued a bill
// (documents.legal_entity_id) and that company's paper identity (legal_entities). Proves a
// signed-in (authenticated) user can run the tablet's EXACT selects — a hidden column would
// quietly drop the slip. READ-ONLY, inside a transaction that rolls back. TEST Sandbox only.
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-tablet-slip-reads.mjs
import pg from "pg";

const SANDBOX = "22222222-2222-4222-8222-000000000002";
const SANDBOX_OWNER = "b729191b-1159-4d46-88c7-3c9aceb5e664";

// Kept word for word with PosApi.kt (SALE_COLS' document columns, ISSUER_COLS).
const DOC_COLS = "id, number, doc_type, status, issued_at, total_incl, vat_total, amount_paid, bill_no, bill_to_brn, bill_to_vat_number, legal_entity_id";
const ISSUER_COLS = "id, legal_name, trading_name, is_default, vat_registered, brn, vat_number, address, phone, receipt_logo_path, receipt_footer_text";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
try {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: SANDBOX_OWNER, role: "authenticated" })]);
  console.log("As a signed-in TEST Sandbox user:");
  const docs = (await c.query(`select ${DOC_COLS} from documents where doc_type = 'invoice' and status <> 'draft' order by issued_at desc nulls last limit 20`)).rows;
  check("the tablet's bill columns read, legal_entity_id included", docs.length > 0, `${docs.length} bills`);
  check("every bill read is the sandbox's own", (await c.query(`select count(*)::int n from documents where tenant_id <> $1`, [SANDBOX])).rows[0].n === 0);
  const named = docs.filter((d) => d.legal_entity_id);
  console.log(`    (${named.length} of them name their company)`);
  const cos = (await c.query(`select ${ISSUER_COLS} from legal_entities`)).rows;
  check("the company identity columns read", cos.length > 0, `${cos.length} compan${cos.length === 1 ? "y" : "ies"}`);
  for (const d of named) {
    const hit = cos.find((co) => co.id === d.legal_entity_id);
    if (!hit) { check(`${d.number}'s company is readable`, false); }
  }
  check("every named company is readable (no slip would be dropped)", named.every((d) => cos.some((co) => co.id === d.legal_entity_id)));
  const byId = named[0]?.legal_entity_id ?? cos[0]?.id;
  const one = (await c.query(`select ${ISSUER_COLS} from legal_entities where id = $1`, [byId])).rows;
  check("fetch-by-id returns the company", one.length === 1, one[0]?.trading_name ?? one[0]?.legal_name);
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(failures ? `\n${failures} FAILED` : "\nall good — rolled back, nothing written");
process.exit(failures ? 1 : 0);
