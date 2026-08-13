// READ-ONLY audit, all tenants: lines whose basis disagrees with their source-quote line
// (the broken-copy signature), plus any line of a flagged product created without the flag.
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";
requireEnv("SUPABASE_DB_URL", DB_URL);
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

// A) copies that dropped the flag: doc has a source, line unflagged, source line flagged.
const a = await c.query(`
  select bs.trading_name shop, d.doc_type, d.number, d.status, dl.title,
         dl.unit_price::text unit, (dl.line_total_excl + dl.line_vat)::text incl,
         q.number source_number, d.created_at
  from public.document_lines dl
  join public.documents d on d.id = dl.document_id
  join public.documents q on q.id = d.source_document_id
  join public.document_lines ql on ql.document_id = q.id and ql.sort_order = dl.sort_order
  join public.business_settings bs on bs.id = d.tenant_id
  where ql.price_includes_vat = true and dl.price_includes_vat = false
  order by d.created_at desc`);
console.log(`── A) copies that dropped a flagged basis: ${a.rows.length} ──`);
if (a.rows.length) console.table(a.rows);

// B) lines selling a FLAGGED product without the flag, since the product was flagged.
const b = await c.query(`
  select bs.trading_name shop, d.doc_type, d.number, d.status, dl.title,
         dl.unit_price::text unit, (dl.line_total_excl + dl.line_vat)::text incl, d.created_at
  from public.document_lines dl
  join public.documents d on d.id = dl.document_id
  join public.products p on p.id = dl.product_id and p.price_includes_vat
  join public.business_settings bs on bs.id = d.tenant_id
  where dl.price_includes_vat = false and d.created_at >= p.updated_at
  order by d.created_at desc`);
console.log(`\n── B) flagged-product lines sold unflagged (after flagging): ${b.rows.length} ──`);
if (b.rows.length) console.table(b.rows);
await c.end();
