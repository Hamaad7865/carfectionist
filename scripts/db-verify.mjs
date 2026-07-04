// Quick Phase 0 DoD checks against the hosted DB.
import pg from 'pg';
import { DB_URL, requireEnv } from './_env.mjs';

requireEnv('SUPABASE_DB_URL', DB_URL);

const client = new pg.Client({ connectionString: DB_URL });
const q = async (label, sql) => {
  const { rows } = await client.query(sql);
  console.log(`\n▸ ${label}`);
  console.table(rows);
};

try {
  await client.connect();
  await q('business_settings (series state)',
    `select legal_name, trading_name, quote_prefix, quote_next_number,
            invoice_prefix, invoice_next_number from business_settings`);
  await q('app_users by role',
    `select role, count(*)::int as n from app_users group by role order by role`);
  await q('stock_on_hand — rows per location',
    `select l.name as location, count(*)::int as products, sum(s.qty_on_hand)::numeric as total_qty
     from stock_on_hand s join stock_locations l on l.id = s.location_id
     group by l.name order by l.name`);
  await q('catalogue counts',
    `select kind, count(*)::int as n from products group by kind order by kind`);
  await q('sample on-hand (Storeroom, 5 rows)',
    `select p.name, s.qty_on_hand, p.unit
     from stock_on_hand s
     join products p on p.id = s.product_id
     join stock_locations l on l.id = s.location_id
     where l.name = 'Storeroom' order by p.name limit 5`);
} catch (err) {
  console.error('✗ verify failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
