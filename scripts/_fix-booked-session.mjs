// Finishes the two backdates: moves booked_session_id to match cash_session_id.
//
// WHAT I GOT WRONG. payments carries TWO session links, and the earlier backdate
// scripts only moved one of them:
//   • cash_session_id   — which till the money belongs to. Moved. Correct.
//   • booked_session_id — which till's Z-REPORT counts it. Left on 09/09.
// record_payment writes the same session to both (340 of the 348 live payments have
// them equal; the 8 that differ are reversals, where a refund is deliberately booked
// to the till that is open now rather than the one the original sale used).
//
// WHY IT MATTERS. app.z_totals — the one function behind every Z, service and day —
// scopes payments by booked_session_id, NOT by received_at and not by
// cash_session_id. So both payments still sit in today's trading day as far as the
// Z is concerned. close_day recomputes live, which means closing 09/09 today would
// still put Rs 70,650 (Atish's Rs 69,000 Juice + etienne's Rs 1,650 card) into a day
// that took neither. This does not fix itself; it has to be corrected before the
// day is closed.
//
// WHAT THIS DOES NOT TOUCH:
//   • Z000074, already printed. Its own SERVICE figures were always right — cash
//     1,100, bank transfer 935, juice 11,606 over 4. Only the "Period" block on that
//     slip (a running day-so-far total, captured at 14:11 while the correction was
//     half-applied) overstates. It is frozen JSON and stays as printed.
//   • Z000054 (20/08) and Z000067 (02/09) — both cover physical CASH DRAWERS. This
//     money is Juice and card on the back-office desk till, which never entered a
//     drawer. Asserted below rather than assumed.
//   • No day-Z exists for 20/08, 02/09 or 09/09 — all three trading days are still
//     open — so nothing already sealed changes.
//
//   node scripts/_fix-booked-session.mjs           # dry run, rolled back
//   node scripts/_fix-booked-session.mjs --commit  # for real
import { config } from "dotenv";
import pg from "pg";
config({ path: ".env" });

const COMMIT = process.argv.includes("--commit");
const OWNER_AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh
const TENANT = "11111111-1111-4111-8111-000000000001";

const TARGETS = [
  { invoice: "INV-0242", amount: 69000.0, method: "juice", day: "2026-08-20", till: "2f2c25c5-e203-4387-ad7d-82b73d1cdc80" },
  { invoice: "INV-0238", amount: 1650.0, method: "card", day: "2026-09-02", till: "d8935008-2b7e-43ce-be64-498f403be96a" },
];
const TODAY_DAY = "a4199a8d-4a6c-4584-a7b5-f149cbedfcff"; // 09/09, still open

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL.trim(), ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};
/** What a Z for this scope would say RIGHT NOW, without writing one. */
const dayMoney = async (dayId) => {
  const { rows } = await c.query(`select app.z_totals($1, null, $2, now()) t`, [TENANT, dayId]);
  const m = rows[0].t.methods ?? [];
  return Object.fromEntries(m.map((x) => [x.method, Number(x.net)]));
};

try {
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" })]);

  const before = await dayMoney(TODAY_DAY);
  console.log("→ 09/09 as the Z sees it now:", JSON.stringify(before), "\n");

  for (const t of TARGETS) {
    const { rows: [p] } = await c.query(
      `select p.id, p.amount, p.method, p.cash_session_id, p.booked_session_id, p.reverses_payment_id
         from public.payments p join public.documents d on d.id = p.document_id
        where d.number = $1 and p.amount = $2`, [t.invoice, t.amount]);
    check(`0 ${t.invoice} is the ${t.method} payment already moved to its real till`,
      p && p.method === t.method && p.cash_session_id === t.till, `${p?.method} on ${p?.cash_session_id?.slice(0, 8)}`);
    // A reversal legitimately books to a different till. These are not reversals, so
    // the two columns SHOULD agree, and that is the only reason this edit is safe.
    check(`0b ${t.invoice} is an ordinary payment, not a reversal`, p && p.reverses_payment_id === null);
  }
  if (failed) throw new Error("preconditions not met — nothing touched");

  await c.query(`alter table public.payments disable trigger trg_payments_append_only`);
  let moved = 0;
  try {
    for (const t of TARGETS) {
      const { rowCount } = await c.query(
        `update public.payments p
            set booked_session_id = p.cash_session_id
           from public.documents d
          where d.id = p.document_id and d.number = $1 and p.amount = $2
            and p.reverses_payment_id is null`, [t.invoice, t.amount]);
      moved += rowCount;
    }
  } finally {
    await c.query(`alter table public.payments enable trigger trg_payments_append_only`);
  }
  check("1 both payments re-booked", moved === 2, `${moved} row(s)`);

  await c.query(
    `insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
     values ($1, app.current_app_user_id(), 'payment_booking_corrected', 'trading_day', $2, $3::jsonb)`,
    [TENANT, TODAY_DAY, JSON.stringify({
      payments: TARGETS.map((t) => ({ invoice: t.invoice, amount: t.amount, method: t.method, to_day: t.day })),
      reason: "The backdate moved cash_session_id but not booked_session_id, and app.z_totals scopes "
            + "by booked_session_id — so both payments still counted toward the 09/09 Z. Re-booked to the "
            + "same till their cash_session_id already names. Amounts, methods and payers unchanged.",
      note: "Z000074 was printed at 14:11 on 09/09 with these still included; its Period block overstates "
          + "by Rs 70,650 and is frozen. Its own service figures were always correct.",
    })]);

  // ── what each day says now ─────────────────────────────────────────────────
  const after = await dayMoney(TODAY_DAY);
  console.log("\n→ 09/09 after:", JSON.stringify(after));
  check("2 the Rs 69,000 has left today's Juice",
    (before.juice ?? 0) - (after.juice ?? 0) === 69000, `${before.juice} → ${after.juice}`);
  check("3 the Rs 1,650 card has left today altogether", !after.card, `card ${after.card ?? "gone"}`);
  check("4 nothing else on today moved",
    (after.cash ?? 0) === (before.cash ?? 0) && (after.bank_transfer ?? 0) === (before.bank_transfer ?? 0),
    `cash ${after.cash}, bank ${after.bank_transfer}`);

  for (const t of TARGETS) {
    const { rows: [d] } = await c.query(
      `select id from public.trading_days where tenant_id = $1 and business_date = $2::date`, [TENANT, t.day]);
    const m = await dayMoney(d.id);
    check(`5 ${t.day} now carries the Rs ${t.amount.toLocaleString()} ${t.method}`,
      Math.abs((m[t.method] ?? 0) - t.amount) < 0.01 || (m[t.method] ?? 0) >= t.amount,
      `${t.day}: ${JSON.stringify(m)}`);
  }

  // The two printed cash-drawer Zs must be untouched — this money never saw a drawer.
  for (const [num, total] of [["Z000054", 3564], ["Z000067", 7884.01]]) {
    const { rows: [z] } = await c.query(`select totals->>'total_incl' t from public.z_reports where number = $1`, [num]);
    check(`6 ${num} (a cash drawer) is untouched`, Number(z.t) === total, `Rs ${z.t}`);
  }

  if (failed) throw new Error("a check failed — refusing to commit");
  if (COMMIT) { await c.query("commit"); console.log("\n✓ COMMITTED"); }
  else { await c.query("rollback"); console.log("\n✓ dry run only — rolled back, nothing written"); }
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("\n✗", e.message, "— rolled back");
  failed = true;
} finally {
  await c.end();
}
process.exit(failed ? 1 : 0);
