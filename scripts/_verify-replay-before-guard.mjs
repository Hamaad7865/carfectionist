// Verifies 20260802000010_issue_document_replays_before_it_guards.sql against the
// LIVE DB. Every scenario runs inside BEGIN/ROLLBACK — nothing survives.
//
//   0. BUG      — the CURRENTLY INSTALLED function refuses a replay once the day
//                 is closed ("the day is closed"), proving the regression is real.
//   1. FIXED    — after the migration, that same replay returns the cached invoice.
//   2. STILL    — a NEW sale on a closed day is still refused (guard not weakened).
//   3. STALE    — a replay through a till left on yesterday's day returns the
//                 invoice; a NEW sale on that till is still refused.
//   4. NORMAL   — an ordinary sale on today's open till still issues and numbers.
//
// Check 0 only passes on a database that still has the regression; once the migration is
// applied it reports the fix instead. Keep this: the ordering has been reverted once
// already, by a migration that rebuilt the function from older text.
import { readFileSync } from "node:fs";
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const MIGRATION = readFileSync(
  "supabase/migrations/20260802000010_issue_document_replays_before_it_guards.sql",
  "utf8",
);

const c = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

// ── live ids (seed UUIDs are long dead; probe for what is actually there) ────
const { rows: [biz] } = await c.query(`select id from public.business_settings limit 1`);
const TENANT = biz.id;
const { rows: [owner] } = await c.query(
  `select id, auth_user_id from public.app_users
    where tenant_id = $1 and role = 'owner' and auth_user_id is not null
    order by created_at limit 1`, [TENANT]);
const APP_USER = owner.id;
const OWNER_AUTH = owner.auth_user_id;
console.log(`tenant ${TENANT}\nowner  ${APP_USER} (auth ${OWNER_AUTH})\n`);

const asOwner = () =>
  c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: OWNER_AUTH, role: "authenticated" })]);

/** A draft invoice with one ad-hoc line. Only ever inside a rolled-back txn. */
async function mkDraft() {
  const { rows: [cust] } = await c.query(
    `select id from public.customers where tenant_id = $1 limit 1`, [TENANT]);
  const { rows: [doc] } = await c.query(
    `insert into public.documents (tenant_id, doc_type, status, customer_id, created_by, origin)
     values ($1, 'invoice', 'draft', $2, $3, 'standalone') returning id`,
    [TENANT, cust.id, APP_USER]);
  await c.query(
    `insert into public.document_lines (tenant_id, document_id, title, qty, unit_price, vat_rate, sort_order)
     values ($1, $2, 'replay-guard probe', 1, 100, 15, 1)`, [TENANT, doc.id]);
  return doc.id;
}

let deviceN = 0;
/** An open session on a trading day of the given date, both minted for this txn. */
async function mkSession(businessDate) {
  const { rows: existing } = await c.query(
    `select id from public.trading_days where tenant_id = $1 and business_date = $2`,
    [TENANT, businessDate]);
  const dayId = existing.length
    ? existing[0].id
    : (await c.query(
        `insert into public.trading_days (tenant_id, business_date, status)
         values ($1, $2, 'open') returning id`, [TENANT, businessDate])).rows[0].id;
  // idx_cash_sessions_open allows ONE open session per device — each probe till
  // gets its own device id or the second insert collides with the first.
  const device = `TAB-PROBE-${++deviceN}`;
  const { rows: [s] } = await c.query(
    `insert into public.cash_sessions
       (tenant_id, device_id, opened_by, opening_float, status, trading_day_id, service_no)
     values ($1, $4, $2, 0, 'open', $3,
             coalesce((select max(service_no) + 1 from public.cash_sessions where trading_day_id = $3), 90))
     returning id`, [TENANT, APP_USER, dayId, device]);
  return { sessionId: s.id, dayId };
}

/**
 * Run something we EXPECT to raise, and hand back the message. A caught error
 * still aborts the surrounding transaction, so each attempt gets its own
 * savepoint to roll back to — otherwise the next check dies with "current
 * transaction is aborted".
 */
let spN = 0;
const raises = async (sql, params) => {
  const sp = `sp${++spN}`;
  await c.query(`savepoint ${sp}`);
  try {
    await c.query(sql, params);
    await c.query(`release savepoint ${sp}`);
    return null;
  } catch (e) {
    await c.query(`rollback to savepoint ${sp}`);
    return e.message;
  }
};

// ::text, not the driver's Date — a `date` comes back at LOCAL midnight, and
// toISOString() in UTC+4 would hand back yesterday.
const { rows: [today] } = await c.query(
  `select app.mu_today()::text as d, (app.mu_today() - 1)::text as y`);
const TODAY = today.d;
const YESTERDAY = today.y;
console.log(`mu_today = ${TODAY}, yesterday = ${YESTERDAY}\n`);

try {
  // ── 0. the bug, on the function as installed right now ────────────────────
  await c.query("begin");
  await asOwner();
  {
    const { sessionId, dayId } = await mkSession(TODAY);
    const doc = await mkDraft();
    const key = `probe:${doc}:issue`;
    const { rows: [issued] } = await c.query(
      `select (public.issue_document($1, null, $2, $3)).number as number`, [doc, key, sessionId]);
    await c.query(`update public.trading_days set status = 'closed' where id = $1`, [dayId]);
    const err = await raises(
      `select public.issue_document($1, null, $2, $3)`, [doc, key, sessionId]);
    // On a patched database this reports "already fixed", which is the desired state —
    // it is a note, not a failure, so a fixed DB doesn't fail the run.
    console.log(
      err !== null && /day is closed/i.test(err)
        ? `· regression still present — replay raised "${err.slice(0, 50)}…" instead of ${issued.number}`
        : `· already fixed — the replay returned ${issued.number}`,
    );
  }
  await c.query("rollback");

  // ── 1-4. the same ground, with the migration applied ──────────────────────
  await c.query("begin");
  await asOwner();
  await c.query(MIGRATION); // DDL is transactional; this rolls back with the rest

  const liveDef = (await c.query(
    `select pg_get_functiondef(p.oid) as d from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'issue_document'`)).rows[0].d;
  check("ordering: replay branch precedes assert_day_open",
    liveDef.indexOf("from public.idempotency_keys") < liveDef.indexOf("perform app.assert_day_open"));

  // Each scenario mutates shared rows (it closes today's trading day, opens
  // tills on it), so each gets its own savepoint and is unwound after — the
  // migration itself was applied above the savepoints and survives them.
  const scenario = async (fn) => {
    await c.query("savepoint scen");
    try { await fn(); } finally { await c.query("rollback to savepoint scen"); }
  };

  // 1 — a replay on a CLOSED day returns the cached invoice
  await scenario(async () => {
    const { sessionId, dayId } = await mkSession(TODAY);
    const doc = await mkDraft();
    const key = `probe:${doc}:issue`;
    const { rows: [first] } = await c.query(
      `select (public.issue_document($1, null, $2, $3)).number as number`, [doc, key, sessionId]);
    await c.query(`update public.trading_days set status = 'closed' where id = $1`, [dayId]);
    const { rows: [replay] } = await c.query(
      `select (public.issue_document($1, null, $2, $3)).number as number`, [doc, key, sessionId]);
    check("FIXED: replay on a closed day returns the same invoice",
      replay.number === first.number, `${first.number} -> ${replay.number}`);

    // 2 — a NEW sale on that closed day is still refused
    const fresh = await mkDraft();
    const err = await raises(`select public.issue_document($1, null, $2, $3)`,
      [fresh, `probe:${fresh}:issue`, sessionId]);
    check("guard intact: a NEW sale on a closed day is still refused",
      err !== null && /day is closed/i.test(err), err?.slice(0, 70) ?? "it was allowed through");
  });

  // 3 — a till left on yesterday: replay OK, new sale refused
  await scenario(async () => {
    const { sessionId } = await mkSession(YESTERDAY);
    const doc = await mkDraft();
    const key = `probe:${doc}:issue`;
    // Issue it while the till is legitimate: stamp the doc through today's session,
    // then replay through the stale one — the key is what the replay keys on.
    const { sessionId: todaySession } = await mkSession(TODAY);
    const { rows: [first] } = await c.query(
      `select (public.issue_document($1, null, $2, $3)).number as number`, [doc, key, todaySession]);
    const { rows: [replay] } = await c.query(
      `select (public.issue_document($1, null, $2, $3)).number as number`, [doc, key, sessionId]);
    check("FIXED: replay through a till stuck on yesterday returns the invoice",
      replay.number === first.number, `${first.number} -> ${replay.number}`);

    const fresh = await mkDraft();
    const err = await raises(`select public.issue_document($1, null, $2, $3)`,
      [fresh, `probe:${fresh}:issue`, sessionId]);
    check("guard intact: a NEW sale on a stale till is still refused",
      err !== null && /still on the day of/i.test(err), err?.slice(0, 70) ?? "it was allowed through");
  });

  // 4 — the ordinary path is untouched
  await scenario(async () => {
    const { sessionId } = await mkSession(TODAY);
    const doc = await mkDraft();
    const { rows: [issued] } = await c.query(
      `select (public.issue_document($1, null, $2, $3)).number as number,
              (public.issue_document($1, null, $2, $3)).status as status`,
      [doc, `probe:${doc}:issue`, sessionId]);
    check("normal sale still issues and numbers",
      !!issued.number && issued.status === "issued", `${issued.number} / ${issued.status}`);
  });

  await c.query("rollback");
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("\n✗ probe threw:", e.message);
  failed = true;
} finally {
  await c.end();
}

console.log(failed ? "\n✗ FAILED" : "\n✓ all checks passed (nothing committed)");
process.exitCode = failed ? 1 : 0;
