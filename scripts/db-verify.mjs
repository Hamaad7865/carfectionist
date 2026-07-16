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
  // Locations are named by the owner, so this check follows the FLAGS. It used
  // to filter on l.name = 'Storeroom' and had been silently matching nothing
  // ever since that location was renamed to Warehouse.
  await q('stock locations',
    `select l.name, l.is_default, l.is_sales_floor, l.is_active,
            coalesce(sum(s.qty_on_hand), 0)::numeric as units
     from stock_locations l
     left join stock_on_hand s on s.location_id = l.id
     group by l.id, l.name, l.is_default, l.is_sales_floor, l.is_active
     order by l.is_default desc, l.name`);
  await q('sample on-hand at the default location (5 rows)',
    `select p.name, s.qty_on_hand, p.unit
     from stock_on_hand s
     join products p on p.id = s.product_id
     join stock_locations l on l.id = s.location_id
     where l.is_default order by p.name limit 5`);
} catch (err) {
  console.error('✗ verify failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
