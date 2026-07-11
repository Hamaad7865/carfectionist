// Rolled-back verification of the second bug-hunt fixes (#1 vat_breakdown single
// authority, #2 receive_transfer accounting guard, #7 reverse_payment cash-session
// recompute). Runs as the owner, asserts, then ROLLS BACK — the real series and
// stock ledger are untouched.
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (expected ${want})`}`);
};
// A raised error aborts the whole txn, so wrap each expected-throw in a savepoint.
const expectThrow = async (label, fn) => {
  await c.query("savepoint sp");
  try { await fn(); check(label, "allowed", "rejected"); await c.query("release savepoint sp"); }
  catch { check(label, "rejected", "rejected"); await c.query("rollback to savepoint sp"); }
};

const c = new pg.Client({ connectionString: DB_URL });
try {
  await c.connect();

  // Resolve live context.
  const owner = (await c.query("select auth_user_id from app_users where role='owner' and is_active limit 1")).rows[0];
  const customer = (await c.query("select id from customers limit 1")).rows[0];
  const prods = (await c.query("select id from products where is_stocked limit 2")).rows;
  const locs = (await c.query("select id, is_default from stock_locations order by is_default desc")).rows;
  const OWNER = owner.auth_user_id, CUSTOMER = customer.id;
  const [P1, P2] = prods.map((p) => p.id);
  const WAREHOUSE = locs.find((l) => l.is_default).id, SHOP = locs.find((l) => !l.is_default).id;

  await c.query("begin");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: OWNER, role: "authenticated" })]);

  // ── Bug #1a — canonical vector still byte-identical after widening the trigger
  console.log("▸ #1a canonical Diamondbrite vector (no discount)");
  const canon = [
    { title: "Full Decontamination & Body Polish", qty: 1, unit_price: 32000, vat_rate: 15 },
    { title: "Remove Wheel, Decontamination & Polish", qty: 4, unit_price: 3800, vat_rate: 15 },
    { title: "Diamondbrite 3-Year Protection", qty: 1, unit_price: 30000, vat_rate: 15 },
  ];
  const dv = (await c.query("select id, subtotal_excl, vat_total, total_incl from public.save_draft($1::jsonb,$2::jsonb,null)",
    [JSON.stringify({ doc_type: "quote", customer_id: CUSTOMER }), JSON.stringify(canon)])).rows[0];
  check("subtotal_excl", dv.subtotal_excl, "77200.00");
  check("total_incl", dv.total_incl, "88780.00");
  await c.query("select public.issue_document($1::uuid,null,null)", [dv.id]);
  const vb = (await c.query("select vat_breakdown from documents where id=$1", [dv.id])).rows[0].vat_breakdown;
  check("vat_breakdown rows", vb.length, "1");
  check("vat_breakdown base", Number(vb[0].base), 77200);
  check("vat_breakdown vat", Number(vb[0].vat), 11580);
  // The stored fiscal snapshot must stay byte-identical (scale 2), not "77200".
  const vbText = (await c.query("select vat_breakdown::text t from documents where id=$1", [dv.id])).rows[0].t;
  check("vat_breakdown text scale-2", /"base": 77200\.00/.test(vbText) && /"vat": 11580\.00/.test(vbText), true);

  // ── Bug #1b — vat_breakdown == header totals under an ORDER-level discount
  console.log("▸ #1b order-discounted invoice: breakdown matches header totals");
  const dlines = [
    { title: "A", qty: 1, unit_price: 1000, vat_rate: 15 },
    { title: "B", qty: 1, unit_price: 500, vat_rate: 0 },
  ];
  const dd = (await c.query("select id from public.save_draft($1::jsonb,$2::jsonb,null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: CUSTOMER, discount_kind: "percent", discount_value: 10 }), JSON.stringify(dlines)])).rows[0];
  await c.query("select public.issue_document($1::uuid,null,null)", [dd.id]);
  const ddr = (await c.query("select subtotal_excl, vat_total, vat_breakdown from documents where id=$1", [dd.id])).rows[0];
  const sumBase = ddr.vat_breakdown.reduce((a, g) => a + Number(g.base), 0).toFixed(2);
  const sumVat = ddr.vat_breakdown.reduce((a, g) => a + Number(g.vat), 0).toFixed(2);
  check("Σbase == subtotal_excl", sumBase, Number(ddr.subtotal_excl).toFixed(2));
  check("Σvat == vat_total", sumVat, Number(ddr.vat_total).toFixed(2));

  // ── Bug #2 — receive_transfer requires every dispatched line to be accounted for
  console.log("▸ #2 receive_transfer accounting guard");
  const tid = (await c.query(
    "insert into stock_transfers (tenant_id, from_location_id, to_location_id, created_by) " +
    "values ((select id from business_settings limit 1), $1, $2, (select id from app_users where auth_user_id=$3)) returning id",
    [WAREHOUSE, SHOP, OWNER])).rows[0].id;
  const ln = [];
  for (const p of [P1, P2]) {
    ln.push((await c.query(
      "insert into stock_transfer_lines (tenant_id, transfer_id, product_id, qty_dispatched) " +
      "values ((select id from business_settings limit 1), $1, $2, 2) returning id", [tid, p])).rows[0].id);
  }
  await c.query("select public.dispatch_transfer($1::uuid)", [tid]);
  await expectThrow("empty p_lines rejected", () => c.query("select public.receive_transfer($1::uuid,'[]'::jsonb)", [tid]));
  await expectThrow("partial p_lines rejected", () =>
    c.query("select public.receive_transfer($1::uuid,$2::jsonb)", [tid, JSON.stringify([{ line_id: ln[0], qty_received: 2 }])]));
  const bothLines = JSON.stringify(ln.map((id) => ({ line_id: id, qty_received: 2 })));
  const recv = (await c.query("select status from public.receive_transfer($1::uuid,$2::jsonb)", [tid, bothLines])).rows[0];
  check("full receipt → status received", recv.status, "received");

  // ── Bug #7 — reversing a cash payment refreshes a CLOSED session's reconciliation
  console.log("▸ #7 reverse_payment recomputes a closed cash session");
  const sess = (await c.query("select id from public.open_cash_session('verify-device', 1000)")).rows[0].id;
  const inv = (await c.query("select id, total_incl from public.save_draft($1::jsonb,$2::jsonb,null)",
    [JSON.stringify({ doc_type: "invoice", customer_id: CUSTOMER }), JSON.stringify([{ title: "svc", qty: 1, unit_price: 1000, vat_rate: 15 }])])).rows[0];
  await c.query("select public.issue_document($1::uuid,null,null)", [inv.id]);
  const total = (await c.query("select total_incl from documents where id=$1", [inv.id])).rows[0].total_incl; // 1150.00
  const pay = (await c.query("select id from public.record_payment($1::uuid,'cash'::payment_method,$2,$2,null,$3::uuid,null,null)",
    [inv.id, total, sess])).rows[0].id;
  const closing = (1000 + Number(total)).toFixed(2); // count everything → variance 0 at close
  const closed = (await c.query("select expected_cash, variance from public.close_cash_session($1::uuid,$2)", [sess, closing])).rows[0];
  check("closed expected_cash", closed.expected_cash, closing);
  check("closed variance (pre-reversal)", closed.variance, "0.00");
  await c.query("select public.reverse_payment($1::uuid,'test')", [pay]);
  const after = (await c.query("select expected_cash, variance from cash_sessions where id=$1", [sess])).rows[0];
  check("expected_cash after reversal", after.expected_cash, "1000.00");
  check("variance after reversal", after.variance, Number(total).toFixed(2)); // now over by the reversed amount

  await c.query("rollback");
  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`} (rolled back)`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (err) {
  try { await c.query("rollback"); } catch {}
  console.error("✗ verify error:", err.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
