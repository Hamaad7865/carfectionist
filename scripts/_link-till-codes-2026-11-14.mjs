// 2026-11-14: the NEOSTRA till (TAB-84A1) lost its app data and came back as TAB-BDAD
// then TAB-36FA. Link both earlier codes to TAB-36FA (the code it trades under now) so
// its Cash Flow / Traceability / Appareil number are one tablet again. One transaction.
import pg from "pg";
const T = "11111111-1111-4111-8111-000000000001";
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query("begin");
  const id = async (code) => (await c.query("select id from devices where tenant_id=$1 and device_code=$2", [T, code])).rows[0].id;
  const [a, b, n] = [await id("TAB-84A1"), await id("TAB-BDAD"), await id("TAB-36FA")];
  for (const old of [a, b]) {
    await c.query("select app.link_device($1, $2, false, null, $3)", [old, n, "support fix 2026-11-14: same till after its app data was wiped"]);
  }
  await c.query("commit");
} catch (e) { await c.query("rollback"); console.error("ROLLED BACK:", e.message); process.exitCode = 1; }
const r = await c.query(`select d.device_code, d.display_name, d.is_active, d.takes_payments, d.first_seen::date, m.device_code as linked_to
  from devices d left join devices m on m.id=d.merged_into where d.tenant_id=$1 and (d.is_active or d.merged_into is not null) order by d.first_seen`, [T]);
console.table(r.rows);
const o = await c.query("select string_agg(device_code, ', ' order by first_seen) from devices where tenant_id=$1 and is_active", [T]);
console.log("Appareil order:", o.rows[0].string_agg);
await c.end();
