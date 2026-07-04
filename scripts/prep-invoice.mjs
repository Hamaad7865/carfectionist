// Drive the money path to a real issued INV-0001 (quote → A00116 → convert →
// INV-0001) so the payments UI can be verified against it. COMMITS (consumes
// the series — this IS the Phase 1 DoD). Prints INVOICE_ID.
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

const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 15000 });
await client.connect();
try {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: OWNER, role: "authenticated" })]);
  const draft = (await client.query("select id from public.save_draft($1::jsonb,$2::jsonb,null)", [JSON.stringify({ doc_type: "quote", customer_id: CUSTOMER }), JSON.stringify(lines)])).rows[0];
  const quote = (await client.query("select number from public.issue_document($1::uuid,null,null)", [draft.id])).rows[0];
  const inv = (await client.query("select id from public.convert_quote_to_invoice($1::uuid)", [draft.id])).rows[0];
  const invIssued = (await client.query("select number from public.issue_document($1::uuid,null,null)", [inv.id])).rows[0];
  await client.query("commit");
  console.log(`quote ${quote.number} → invoice ${invIssued.number}`);
  console.log(`INVOICE_ID ${inv.id}`);
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error("prep failed:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
