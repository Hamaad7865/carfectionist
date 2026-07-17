// Rolled-back verification: a reversal booked on till B for money till A took
// must land on B in EVERY lens — close_cash_session, the web's aggregations
// (booked_session_id), and close_period's takings_by_device — and the old
// cash_session_id lens is demonstrated wrong. Also proves the tablet's durable
// receipt-event contract: a client-minted audit id replays as 23505.
// Runs as `authenticated` impersonating the owner, then ROLLS BACK.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner auth uid)

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: AUTH, role: "authenticated" })]);

  console.log("▸ two tills, one cash sale of 1150 on A");
  const a = (await c.query("select id from public.open_cash_session('VT-A', 1000)")).rows[0].id;
  const b = (await c.query("select id from public.open_cash_session('VT-B', 1000)")).rows[0].id;
  const customer = (await c.query("select id from customers limit 1")).rows[0].id;
  const draft = await c.query("select id from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ doc_type: "invoice", customer_id: customer }),
    JSON.stringify([{ product_id: null, title: "Cross-till test", qty: 1, unit_price: 1000, vat_rate: 15 }]),
  ]);
  const inv = draft.rows[0].id;
  await c.query("select public.issue_document($1::uuid, null, null)", [inv]);
  const pay = (await c.query("select id from public.record_payment($1::uuid, 'cash', 1150, 1150, null, $2::uuid, null, null)", [inv, a])).rows[0].id;

  console.log("▸ refund it ON TILL B (the drawer the money physically leaves)");
  const mirror = (await c.query("select id, cash_session_id, booked_session_id from public.reverse_payment($1::uuid, 'cross-till test', $2::uuid)", [pay, b])).rows[0];
  check("mirror keeps A as the taking till", mirror.cash_session_id, a);
  check("mirror books B as the moved drawer", mirror.booked_session_id, b);

  console.log("▸ the web's lens (booked) matches the drawers");
  const lens = async (col, sid) =>
    (await c.query(`select coalesce(sum(amount),0) s from payments where ${col} = $1 and method = 'cash'`, [sid])).rows[0].s;
  check("A by booked = +1150", await lens("booked_session_id", a), "1150.00");
  check("B by booked = -1150", await lens("booked_session_id", b), "-1150.00");
  // The defect being fixed: by cash_session_id BOTH rows sit on A (net 0) and B sees nothing.
  check("old lens put A at net 0 (wrong)", await lens("cash_session_id", a), "0.00");
  check("old lens left B empty (wrong)", await lens("cash_session_id", b), "0");

  console.log("▸ the close agrees with the booked lens");
  const closedA = (await c.query("select expected_cash, variance from public.close_cash_session($1::uuid, 2150)", [a])).rows[0];
  check("A close expects float+sale = 2150", closedA.expected_cash, "2150.00");
  check("A variance 0", closedA.variance, "0.00");
  const closedB = (await c.query("select expected_cash from public.close_cash_session($1::uuid, 0)", [b])).rows[0];
  check("B close expects float-refund = -150", closedB.expected_cash, "-150.00");

  console.log("▸ close_period's device attribution (new coalesce join)");
  const dev = await c.query(
    `select coalesce(cs.device_id, 'unattributed') dev, sum(p.amount) amt
       from payments p
       left join cash_sessions cs on cs.id = coalesce(p.booked_session_id, p.cash_session_id)
      where p.id = any($1::uuid[]) group by 1 order by 1`,
    [[pay, mirror.id]],
  );
  check("VT-A carries the sale", `${dev.rows[0]?.dev}:${dev.rows[0]?.amt}`, "VT-A:1150.00");
  check("VT-B carries the refund", `${dev.rows[1]?.dev}:${dev.rows[1]?.amt}`, "VT-B:-1150.00");

  console.log("▸ tablet receipt-event contract: same id replays as duplicate, not double");
  const evId = crypto.randomUUID();
  const tenant = (await c.query("select tenant_id from customers limit 1")).rows[0].tenant_id;
  const at = "2026-07-17T12:00:00.000Z";
  await c.query(
    "insert into audit_events (id, tenant_id, event_type, device_id, payload, created_at) values ($1, $2, 'receipt_printed', 'VT-A', '{\"number\":\"INV-TEST\"}', $3)",
    [evId, tenant, at],
  );
  const stamped = (await c.query("select created_at from audit_events where id = $1", [evId])).rows[0];
  check("event keeps the moment it happened", stamped.created_at.toISOString(), at);
  try {
    await c.query("savepoint dup");
    await c.query(
      "insert into audit_events (id, tenant_id, event_type, device_id, payload) values ($1, $2, 'receipt_printed', 'VT-A', '{}')",
      [evId, tenant],
    );
    check("replayed id rejected with 23505", "allowed", "23505");
  } catch (e) {
    await c.query("rollback to savepoint dup");
    check("replayed id rejected with 23505", e.code, "23505");
  }

  await c.query("rollback");
  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`} (rolled back — nothing persisted)`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  try { await c.query("rollback"); } catch {}
  console.error("✗ verify error:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
