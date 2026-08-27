// Dry-run for the jobs "Record a payment" path (apps/web/src/features/jobs/actions.ts
// ::recordPaymentAction, UI: PartPayment in JobCard.tsx). One rolled-back transaction —
// nothing persists.
//
// Proves:
//   BUG (pre-fix): recordPaymentAction passed NO cash session, so record_payment's till
//     gate (20260716000040) refused every method — card / Juice / bank — with
//     "must be taken on an open till". The back-office job part-payment path was dead.
//   FIX: resolve the virtual desk till (back_office_till, same as documents/actions.ts)
//     and pass it — the part-payment lands, booked to that session, and the session is
//     on today's Mauritius date so the stale-till guard never trips.
//
//   node scripts/_verify-job-part-payment-till.mjs
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const OWNER_AUTH_UID = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner)

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
let ok = true;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) ok = false;
};
const expectError = async (name, sql, params, needle) => {
  await c.query("savepoint exp");
  try {
    await c.query(sql, params);
    check(name, false, "no error was raised");
  } catch (e) {
    check(name, e.message.includes(needle), e.message.slice(0, 120));
  }
  await c.query("rollback to savepoint exp");
};

try {
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: OWNER_AUTH_UID, role: "authenticated" }),
  ]);
  const tenant = (await c.query(`select app.current_tenant_id() t`)).rows[0].t;
  // Neutralise a closed trading day for the duration of this rolled-back tx.
  await c.query(
    `update public.trading_days set status='open' where tenant_id=$1 and business_date=app.mu_today() and status='closed'`,
    [tenant],
  );

  // The shape PartPayment renders for: a live invoice raised from a job, still owed on.
  // Fall back to any open invoice so the script still runs when none is job-linked.
  const inv =
    (
      await c.query(`
      select id, number, job_id from public.documents
       where doc_type='invoice' and status in ('issued','partly_paid') and job_id is not null
       order by created_at desc limit 1`)
    ).rows[0] ||
    (
      await c.query(`
      select id, number, job_id from public.documents
       where doc_type='invoice' and status in ('issued','partly_paid')
       order by created_at desc limit 1`)
    ).rows[0];
  if (!inv) {
    console.log("⚠ no open invoice to test with");
    process.exit(1);
  }
  console.log(`invoice ${inv.number}${inv.job_id ? ` (job ${inv.job_id})` : " (no job link)"}`);

  // ── pre-fix bug: no session → every method refused ────────────────────────
  console.log("— pre-fix: recordPaymentAction passed no cash session —");
  for (const method of ["bank_transfer", "card", "juice"]) {
    await expectError(
      `${method} part-payment refused with no till`,
      `select public.record_payment($1,$2::payment_method,0.01,null,'DRYRUN',null,null,$3)`,
      [inv.id, method, `vjpp:no-till:${method}`],
      "must be taken on an open till",
    );
  }

  // ── fix: resolve the desk till and pass it ────────────────────────────────
  console.log("— fix: back_office_till() resolved and passed (mirrors documents/actions.ts) —");
  const till = (await c.query(`select (public.back_office_till()).id`)).rows[0].id;
  check("back_office_till() returns a session id", !!till, till);
  const onToday = (
    await c.query(
      `select 1 from public.cash_sessions cs
         join public.trading_days td on td.id = cs.trading_day_id
        where cs.id=$1 and cs.tenant_id=$2 and cs.status='open' and td.business_date=app.mu_today()`,
      [till, tenant],
    )
  ).rowCount;
  check("the desk till is open and on today's Mauritius trading day", onToday === 1);

  const pay = (
    await c.query(
      `select * from public.record_payment($1,'bank_transfer'::payment_method,0.01,null,'DRYRUN',$2,null,'vjpp:with-till')`,
      [inv.id, till],
    )
  ).rows[0];
  check("part-payment lands, booked to the desk till", pay.booked_session_id === till, `booked=${pay.booked_session_id}`);

  await c.query("rollback");
  console.log(`\n${ok ? "PASS" : "FAIL"} — transaction rolled back, nothing persisted.`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("✗ dry-run error:", e.message);
  process.exit(1);
} finally {
  await c.end();
}
