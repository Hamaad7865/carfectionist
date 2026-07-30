// One-off surgical fix — 30 July 2026.
//
// TAB-84A1's till (cash_session 8c152892…) was opened 29 July and never closed,
// so four invoices rung on 30 July were stamped business_day=2026-07-29 and
// vanished from the 30th's Sales Journal (which groups by business_day).
//
//   1. Re-stamp the 4 documents onto business_day 2026-07-30.
//   2. Re-point the still-open session onto the 30th's trading day as Service 2
//      (Service 1 on the 30th is TAB-66D2), so tonight's close Z lands on the
//      right day and any FURTHER sale on that tablet books to the 30th.
//
// Payments already hang off the session (payments.cash_session_id) and follow it.
// Runs in ONE transaction. Default is DRY RUN (rollback); pass --commit to keep.
import { config } from "dotenv";
import pg from "pg";
config({ path: ".env" });

const COMMIT = process.argv.includes("--commit");
const SESSION = "8c152892-e610-4137-b6aa-d4f2d0bed105"; // TAB-84A1, opened 29 Jul, still open
const DAY30 = "d0ae2ad9-be10-4f2b-9af4-254ab4b8e7e0"; // trading_days row for 2026-07-30
const DOCS = ["INV-0047", "INV-0048", "INV-0049", "INV-0050"];

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL.trim(), ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query("begin");

  // The fiscal lock (trg_documents_fiscal_lock) rightly forbids touching issued
  // documents; business_day is not on its whitelist. This is a sanctioned data
  // correction, so ONLY that trigger steps aside, inside this transaction —
  // FK checks and updated_at stay live, and it is re-enabled before commit.
  await c.query("alter table public.documents disable trigger trg_documents_fiscal_lock");

  // Take row locks + re-verify the premise INSIDE the transaction, so a
  // concurrent sale or a repeat run cannot double-apply.
  const { rows: pre } = await c.query(
    `select number from public.documents
      where number = any($1) and business_day = '2026-07-29'
        and cash_session_id = $2 and doc_type = 'invoice'
        and status in ('issued','partly_paid','paid')
      for update`,
    [DOCS, SESSION],
  );
  if (pre.length !== DOCS.length) {
    throw new Error(`premise changed: expected ${DOCS.length} drifted docs, found ${pre.length} (${pre.map((r) => r.number).join(",") || "none"}) — aborting, nothing written`);
  }
  const { rows: sess } = await c.query(
    `select id from public.cash_sessions
      where id = $1 and status = 'open'
        and trading_day_id = '72dd86b7-e43c-4392-8a5a-890ef8f9ccae'
      for update`,
    [SESSION],
  );
  if (sess.length !== 1) throw new Error("premise changed: stale session not open on the 29th's day any more — aborting");
  const { rows: day } = await c.query(
    `select 1 from public.trading_days where id = $1 and business_date = '2026-07-30'`,
    [DAY30],
  );
  if (day.length !== 1) throw new Error("premise changed: the 30th's trading day row is not where expected — aborting");

  const d = await c.query(
    `update public.documents set business_day = '2026-07-30'
      where number = any($1) and business_day = '2026-07-29' and cash_session_id = $2`,
    [DOCS, SESSION],
  );
  const s = await c.query(
    `update public.cash_sessions set trading_day_id = $2, service_no = 2, updated_at = now()
      where id = $1`,
    [SESSION, DAY30],
  );
  console.log(`updated: ${d.rowCount} documents re-stamped, ${s.rowCount} session re-pointed`);

  // Post-conditions, verified before deciding to keep anything.
  const { rows: after } = await c.query(`
    select (select count(*)::int from public.documents
             where doc_type='invoice' and status in ('issued','partly_paid','paid') and business_day='2026-07-30') as tickets_30,
           (select coalesce(sum(total_incl),0)::text from public.documents
             where doc_type in ('invoice','credit_note') and status in ('issued','partly_paid','paid') and business_day='2026-07-30') as incl_30,
           (select count(*)::int from public.documents
             where doc_type='invoice' and status in ('issued','partly_paid','paid') and business_day='2026-07-29') as tickets_29,
           (select coalesce(sum(total_incl),0)::text from public.documents
             where doc_type in ('invoice','credit_note') and status in ('issued','partly_paid','paid') and business_day='2026-07-29') as incl_29,
           (select business_date::text from public.cash_sessions cs join public.trading_days td on td.id=cs.trading_day_id
             where cs.id=$1) as session_day,
           (select service_no from public.cash_sessions where id=$1) as service_no`,
    [SESSION],
  );
  const a = after[0];
  console.log(`post-check: 30th → ${a.tickets_30} tickets / Rs ${a.incl_30};  29th → ${a.tickets_29} tickets / Rs ${a.incl_29};  session now on ${a.session_day} as Service ${a.service_no}`);

  const ok = a.tickets_30 === 7 && a.incl_30 === "33293.20" && a.tickets_29 === 3 && a.incl_29 === "12700.00" && a.session_day === "2026-07-30" && a.service_no === 2;
  if (!ok) throw new Error("post-conditions NOT met — rolling back");

  await c.query("alter table public.documents enable trigger trg_documents_fiscal_lock");

  if (COMMIT) {
    await c.query("commit");
    console.log("\n✓ COMMITTED — journal for the 30th now shows all 7 sales.");
  } else {
    await c.query("rollback");
    console.log("\n✓ DRY RUN passed (rolled back). Run again with --commit to apply.");
  }
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("✗ rolled back:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
