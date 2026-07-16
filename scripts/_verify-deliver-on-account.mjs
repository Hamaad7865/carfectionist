// Dry-run for deliver_on_account (migration 20260716000020) against the LIVE DB,
// entirely inside a transaction that is ROLLED BACK — nothing is persisted.
//
// Proves: a credit collect (which records NO payment) moves a READY job to
// 'delivered' while leaving the invoice outstanding — the reported bug's fix.
//
//   node scripts/_verify-deliver-on-account.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(__dirname, "..", "supabase/migrations/20260716000020_deliver_on_account.sql"),
  "utf8",
);
const OWNER_AUTH_UID = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner)

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
let ok = true;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) ok = false;
};

try {
  await c.query("begin");
  await c.query(migration); // install the function under test (rolled back)
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: OWNER_AUTH_UID, role: "authenticated" }),
  ]);

  const ctx = (await c.query(
    `select app.current_tenant_id() tid, app.current_app_user_id() uid, app.current_user_role()::text role`,
  )).rows[0];
  console.log("context:", ctx);
  check("owner context resolves", !!ctx.tid && !!ctx.uid && ctx.role, JSON.stringify(ctx));

  // A live candidate: an outstanding invoice with a customer whose job is READY.
  const cand = (await c.query(`
    select d.id inv_id, d.number, d.status inv_status, d.amount_paid, d.total_incl, d.job_id, j.status job_status
      from public.documents d join public.jobs j on j.id = d.job_id
     where d.doc_type = 'invoice' and d.status in ('issued','partly_paid')
       and d.customer_id is not null and j.status = 'ready'
     limit 1`)).rows[0];

  if (!cand) {
    console.log("\n⚠ No live READY-job + outstanding-invoice candidate to test against right now.");
    console.log("  (The function installed cleanly. Re-run when such a job exists, or test on the tablet.)");
    // Still prove the walk-in / no-job branch returns false without erroring:
    const anyInv = (await c.query(`
      select id from public.documents
       where doc_type='invoice' and status in ('issued','partly_paid') and customer_id is not null and job_id is null
       limit 1`)).rows[0];
    if (anyInv) {
      const r = (await c.query(`select public.deliver_on_account($1) moved`, [anyInv.id])).rows[0];
      check("no-job invoice returns false (nothing to hand over)", r.moved === false, `moved=${r.moved}`);
    }
    await c.query("rollback");
    console.log(`\n${ok ? "PARTIAL PASS (install + no-job branch)" : "FAIL"} — rolled back.`);
    process.exit(ok ? 0 : 1);
  }

  console.log("\ncandidate:", cand);
  const payBefore = (await c.query(
    `select coalesce(sum(amount),0) paid, count(*) n from public.payments where document_id = $1`,
    [cand.inv_id],
  )).rows[0];

  // The call under test — a credit collect's server side.
  const moved = (await c.query(`select public.deliver_on_account($1) as moved`, [cand.inv_id])).rows[0].moved;

  const jobAfter = (await c.query(`select status, delivered_at from public.jobs where id = $1`, [cand.job_id])).rows[0];
  const docAfter = (await c.query(
    `select status, amount_paid from public.documents where id = $1`, [cand.inv_id],
  )).rows[0];
  const payAfter = (await c.query(
    `select coalesce(sum(amount),0) paid, count(*) n from public.payments where document_id = $1`,
    [cand.inv_id],
  )).rows[0];
  const audit = (await c.query(
    `select payload from public.audit_events where ref_type='job' and ref_id=$1 and event_type='job_delivered' order by created_at desc limit 1`,
    [cand.job_id],
  )).rows[0];

  console.log("");
  check("RPC returned moved=true", moved === true, `moved=${moved}`);
  check("job is now delivered", jobAfter.status === "delivered", `status=${jobAfter.status}`);
  check("delivered_at was stamped", !!jobAfter.delivered_at, `${jobAfter.delivered_at}`);
  check("invoice status UNCHANGED (still outstanding)", docAfter.status === cand.inv_status,
    `${cand.inv_status} → ${docAfter.status}`);
  check("invoice amount_paid UNCHANGED", String(docAfter.amount_paid) === String(cand.amount_paid),
    `${cand.amount_paid} → ${docAfter.amount_paid}`);
  check("NO payment row was created", Number(payAfter.n) === Number(payBefore.n),
    `payments: ${payBefore.n} → ${payAfter.n}`);
  check("audit crumb 'taken on account' written", audit?.payload?.via === "taken on account",
    JSON.stringify(audit?.payload));

  // Idempotency: a second tap is a harmless no-op (job already delivered).
  const moved2 = (await c.query(`select public.deliver_on_account($1) as moved`, [cand.inv_id])).rows[0].moved;
  check("second call is a no-op (returns false)", moved2 === false, `moved=${moved2}`);

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
