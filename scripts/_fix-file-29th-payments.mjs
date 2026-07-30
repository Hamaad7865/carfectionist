// One-off surgical fix #2 — 30 July 2026 (companion to _fix-drifted-till-day.mjs).
//
// After TAB-84A1's straddling session was re-pointed onto the 30th, the three
// payments it took on the 29th (INV-0042/43/44: Juice 935 + 1540, card 10225 =
// Rs 12,700) followed it — z_totals day-scopes payments via booked_session_id →
// cash_sessions.trading_day_id. Result: the 29th's Z shows 3 tickets and NO
// money; the 30th's day-period (printed on tonight's service Z!) double-counts
// by exactly Rs 12,700.
//
// Repair: a CLOSED "filing" service on the 29th's trading day (Service 1 of the
// 29th — which is what that session physically was before the re-point), and
// the three payments' booked_session_id moved onto it. cash_session_id is left
// untouched everywhere — which physical drawer took the money stays true; only
// the "whose Z counts it" pointer moves. This is exactly the split
// booked_session_id was introduced for (b527d11).
//
// payments is append-only by trigger; the pointer update is a sanctioned data
// correction, so the trigger steps aside inside this one transaction only.
// Default DRY RUN (rollback); --commit to apply.
import { config } from "dotenv";
import pg from "pg";
config({ path: ".env" });

const COMMIT = process.argv.includes("--commit");
const TENANT = "11111111-1111-4111-8111-000000000001";
const STALE = "8c152892-e610-4137-b6aa-d4f2d0bed105"; // TAB-84A1's straddling session (now Service 2 of the 30th)
const DAY29 = "72dd86b7-e43c-4392-8a5a-890ef8f9ccae"; // trading day 2026-07-29 (open, as all their days are)
const DAY30 = "d0ae2ad9-be10-4f2b-9af4-254ab4b8e7e0";
const OPENER = "8e44b49a-ff7b-4df8-92e0-0fdc5d5c6eee"; // app_user who really opened the till on the 29th

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL.trim(), ssl: { rejectUnauthorized: false } });
await c.connect();
const methodsNet = async (scopeSession, scopeDay) => {
  const { rows: [r] } = await c.query(
    `select (z->>'total_incl')::numeric as sales,
            coalesce((select sum((m->>'net')::numeric) from jsonb_array_elements(z->'methods') m), 0) as money
       from app.z_totals($1, $2, $3, now()) z`,
    [TENANT, scopeSession, scopeDay],
  );
  return r;
};
try {
  await c.query("begin");
  await c.query("alter table public.payments disable trigger trg_payments_append_only");

  // Premise: exactly the 3 payments of the 29th, still booked to the straddler.
  const { rows: pays } = await c.query(
    `select p.id, d.number, p.method, p.amount::text
       from public.payments p join public.documents d on d.id = p.document_id
      where p.booked_session_id = $1
        and p.received_at < '2026-07-30T00:00:00+04:00'::timestamptz
        and d.number in ('INV-0042','INV-0043','INV-0044')
      for update of p`,
    [STALE],
  );
  if (pays.length !== 3) throw new Error(`premise changed: expected 3 payments of the 29th on the straddler, found ${pays.length}`);
  console.log("moving:", pays.map((p) => `${p.number} ${p.method} ${p.amount}`).join(" · "));

  const { rows: clash } = await c.query(
    `select 1 from public.cash_sessions where trading_day_id = $1`, [DAY29]);
  if (clash.length) throw new Error("premise changed: the 29th's day has sessions again — filing Service 1 would collide");

  const { rows: [filing] } = await c.query(
    `insert into public.cash_sessions
       (tenant_id, device_id, opened_by, opening_float, status, notes,
        opened_at, closed_at, closed_by, trading_day_id, service_no)
     values
       ($1, 'TAB-84A1', $2, 0, 'closed',
        'Filing service for 29 Jul — the till was left open overnight into the 30th. Its 30 Jul sales were re-filed to the 30th (INV-0047–0050); this closed service keeps the 29th''s own payments (INV-0042/43/44, Rs 12,700) on the 29th''s books. No drawer was counted: all three payments are Juice/card. Data correction, 30 Jul 2026.',
        '2026-07-29T15:06:00+04:00', '2026-07-29T23:59:59+04:00', $2, $3, 1)
     returning id`,
    [TENANT, OPENER, DAY29],
  );
  const moved = await c.query(
    `update public.payments set booked_session_id = $1 where id = any($2)`,
    [filing.id, pays.map((p) => p.id)],
  );
  await c.query("alter table public.payments enable trigger trg_payments_append_only");
  console.log(`filing session ${filing.id.slice(0, 8)} created on the 29th; ${moved.rowCount} payments re-booked`);

  // Post-conditions across every Z scope that can print.
  const d29 = await methodsNet(null, DAY29);
  const d30 = await methodsNet(null, DAY30);
  const svc = await methodsNet(STALE, null);
  console.log(`day-29 Z: sales ${d29.sales} / money ${d29.money}   (want 12700.00 / 12700.00)`);
  console.log(`day-30 Z: sales ${d30.sales} / money ${d30.money}   (want 33293.20 / 33293.20)`);
  console.log(`TAB-84A1 service Z: sales ${svc.sales} / money ${svc.money}   (want 26583.21 / 27903.20 — the extra 1319.99 is INV-0051, a desk invoice legitimately paid at this till)`);

  const ok =
    d29.sales === "12700.00" && Number(d29.money) === 12700 &&
    d30.sales === "33293.20" && Number(d30.money) === 33293.2 &&
    svc.sales === "26583.21" && Number(svc.money) === 27903.2;
  if (!ok) throw new Error("post-conditions NOT met — rolling back");

  if (COMMIT) { await c.query("commit"); console.log("\n✓ COMMITTED — every Z scope now foots."); }
  else { await c.query("rollback"); console.log("\n✓ DRY RUN passed (rolled back). Run with --commit to apply."); }
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("✗ rolled back:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
