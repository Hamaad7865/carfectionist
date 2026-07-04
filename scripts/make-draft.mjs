// Dev helper: create a persistent draft Diamondbrite quote (for verifying the
// builder hydration + list), or clean up drafts.
//   node scripts/make-draft.mjs         → creates one, prints DRAFT_ID <uuid>
//   node scripts/make-draft.mjs clean   → deletes all draft documents
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const OWNER = "a0000000-0000-4000-a000-000000000001";
const CUSTOMER = "0c000000-0000-4000-8000-000000000001";
const lines = [
  { product_id: "0e000000-0000-4000-8000-000000000001", title: "Full Decontamination & Body Polish", qty: 1, unit_price: 32000, vat_rate: 15 },
  { product_id: "0e000000-0000-4000-8000-000000000002", title: "Remove Wheel, Decontamination & Polish", qty: 4, unit_price: 3800, vat_rate: 15 },
  { product_id: "0e000000-0000-4000-8000-000000000003", title: "Diamondbrite 3-Year Protection (Exterior Only)", qty: 1, unit_price: 30000, vat_rate: 15 },
];

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();
try {
  if (process.argv[2] === "clean") {
    const r = await client.query("delete from documents where status = 'draft'");
    console.log(`deleted ${r.rowCount} draft(s)`);
  } else {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: OWNER, role: "authenticated" })]);
    const r = await client.query(
      "select id, total_incl from public.save_draft($1::jsonb, $2::jsonb, null)",
      [JSON.stringify({ doc_type: "quote", customer_id: CUSTOMER }), JSON.stringify(lines)],
    );
    await client.query("commit");
    console.log(`total ${r.rows[0].total_incl}`);
    console.log(`DRAFT_ID ${r.rows[0].id}`);
  }
} finally {
  await client.end();
}
