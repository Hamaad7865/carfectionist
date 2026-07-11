// Rolled-back check: reverse_payment now REQUIRES a reason.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner)

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

  const cust = await c.query("select id from customers limit 1");
  const draft = await c.query("select id from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ doc_type: "invoice", customer_id: cust.rows[0].id }),
    JSON.stringify([{ title: "X", qty: 1, unit_price: 100, vat_rate: 15 }]),
  ]);
  await c.query("select public.issue_document($1::uuid, null, null)", [draft.rows[0].id]);
  const pay = await c.query("select id from public.record_payment($1::uuid, 'cash', 115, 115, null, null, null, null)", [draft.rows[0].id]);

  try {
    await c.query("savepoint s1");
    await c.query("select public.reverse_payment($1::uuid, null)", [pay.rows[0].id]);
    check("null reason rejected", "allowed", "rejected");
  } catch { await c.query("rollback to savepoint s1"); check("null reason rejected", "rejected", "rejected"); }
  try {
    await c.query("savepoint s2");
    await c.query("select public.reverse_payment($1::uuid, '  ')", [pay.rows[0].id]);
    check("blank reason rejected", "allowed", "rejected");
  } catch { await c.query("rollback to savepoint s2"); check("blank reason rejected", "rejected", "rejected"); }

  await c.query("select public.reverse_payment($1::uuid, 'customer changed mind')", [pay.rows[0].id]);
  const audit = await c.query("select payload->>'reason' r from audit_events where event_type='payment_reversed' order by created_at desc limit 1");
  check("reason lands in the audit trail", audit.rows[0]?.r, "customer changed mind");

  await c.query("rollback");
  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} FAILED`} (rolled back)`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  try { await c.query("rollback"); } catch {}
  console.error("✗ verify error:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
