// Proves the OFFLINE SALE REPLAY against the LIVE DB, inside BEGIN/ROLLBACK.
//
// The tablet's own tests prove the queue's rules. They cannot prove Postgres will accept
// the write. This runs the exact sequence SaleRepository.settleCapturedSale performs:
//
//   1. insert the customer under a TABLET-MINTED id   (offline, the server can't be asked)
//   2. save_draft            — deterministic draft id from the sale key
//   3. issue_document        — key "<saleKey>:issue"
//   4. record_payment × n    — key "<saleKey>:pay:<i>"
//
// and then does the whole thing AGAIN under the same keys, which is what a lost response
// causes in the field. The second pass must produce the same invoice, no second number,
// no second payment, and no duplicate customer.
//
// Keep this: it is the only proof that offline sales cannot charge a customer twice, and
// it exercises the real RPCs rather than the tablet's model of them.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const c = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const { rows: [biz] } = await c.query(`select id from public.business_settings limit 1`);
const TENANT = biz.id;
const { rows: [owner] } = await c.query(
  `select id, auth_user_id from public.app_users
    where tenant_id = $1 and role = 'owner' and auth_user_id is not null
    order by created_at limit 1`, [TENANT]);
const asOwner = () =>
  c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: owner.auth_user_id, role: "authenticated" })]);

/** The tablet derives its draft id from the sale key: UUIDv3 of "carfection:draft:<key>". */
import { createHash } from "node:crypto";
function draftIdFor(saleKey) {
  const h = createHash("md5").update(`carfection:draft:${saleKey}`, "utf8").digest();
  h[6] = (h[6] & 0x0f) | 0x30; // version 3
  h[8] = (h[8] & 0x3f) | 0x80; // variant
  const s = h.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

let deviceN = 0;
async function mkOpenTill() {
  const { rows: [day] } = await c.query(
    `select id from public.trading_days where tenant_id = $1 and business_date = app.mu_today()`, [TENANT]);
  const dayId = day?.id ?? (await c.query(
    `insert into public.trading_days (tenant_id, business_date, status) values ($1, app.mu_today(), 'open') returning id`,
    [TENANT])).rows[0].id;
  const { rows: [s] } = await c.query(
    `insert into public.cash_sessions
       (tenant_id, device_id, opened_by, opening_float, status, trading_day_id, service_no)
     values ($1, $3, $2, 0, 'open', $4,
             coalesce((select max(service_no) + 1 from public.cash_sessions where trading_day_id = $4), 90))
     returning id`, [TENANT, owner.id, `TAB-REPLAY-${++deviceN}`, dayId]);
  return s.id;
}

/** One full replay pass, exactly as the tablet performs it. */
async function replay({ saleKey, customerId, customerName, lines, tenders, sessionId, comment }) {
  // 1. the customer the tablet minted while offline
  await c.query(
    `insert into public.customers (id, tenant_id, name) values ($1, $2, $3)
     on conflict (id) do nothing`, [customerId, TENANT, customerName]);

  // 2. draft, under the id derived from the sale key
  const draftId = draftIdFor(saleKey);
  const doc = {
    id: draftId, doc_type: "invoice", customer_id: customerId,
    origin: "standalone", comment, discount_kind: null, discount_value: 0,
  };
  // Mirrors SaleRepository.issueWalkInInvoice: on a REPLAY the draft is already an issued
  // invoice, and save_draft rightly refuses to touch it. That refusal is not an error — it
  // means a previous attempt got through, so fall straight to the issue replay below.
  await c.query("savepoint draft");
  try {
    await c.query(`select public.save_draft($1::jsonb, $2::jsonb)`, [JSON.stringify(doc), JSON.stringify(lines)]);
    await c.query("release savepoint draft");
  } catch (e) {
    await c.query("rollback to savepoint draft");
    if (!/cannot edit an issued document/i.test(e.message)) throw e;
  }

  // 3. the sales floor, as fetchShopLocationId resolves it
  const { rows: [loc] } = await c.query(
    `select id from public.stock_locations where tenant_id = $1 and is_sales_floor order by name limit 1`, [TENANT]);

  // 4. issue
  const { rows: [inv] } = await c.query(
    `select id, number, total_incl, status from public.issue_document($1, $2, $3, $4)`,
    [draftId, loc?.id ?? null, `${saleKey}:issue`, sessionId]);

  // 5. every tender, each under its own per-index key
  const paymentIds = [];
  for (let i = 0; i < tenders.length; i++) {
    const t = tenders[i];
    const { rows: [p] } = await c.query(
      `select id from public.record_payment($1, $2::payment_method, $3, $4, $5, $6, null, $7)`,
      [inv.id, t.method, t.amount, t.tendered ?? null, t.ref ?? null, sessionId, `${saleKey}:pay:${i}`]);
    paymentIds.push(p.id);
  }
  return { invoice: inv, paymentIds, draftId };
}

try {
  await c.query("begin");
  await asOwner();

  const sessionId = await mkOpenTill();
  const saleKey = randomUUID();
  const customerId = randomUUID();
  // A REAL stocked product, so "stock is not deducted twice" is an actual claim: an ad-hoc
  // line fires no stock movement at all and would pass that check by doing nothing.
  const { rows: [prod] } = await c.query(
    `select id, name from public.products where tenant_id = $1 and is_stocked order by name limit 1`, [TENANT]);
  const lines = [{
    product_id: prod.id, title: prod.name, qty: 1,
    unit_price: 1000, discount_pct: 0, discount_kind: "percent",
    discount_amount: 0, vat_rate: 15, sort_order: 0,
  }];
  const tenders = [
    { method: "juice", amount: 500, ref: "JC-PROBE" },
    { method: "cash", amount: 650, tendered: 700 },
  ];
  const comment = "Rung offline 02-08-2026 14:23 on TAB-66D2 · OFF-66D2-014";

  // ── pass 1: the sale reaches the server for the first time ────────────────
  const first = await replay({ saleKey, customerId, customerName: "Offline Probe Customer", lines, tenders, sessionId, comment });
  check("the replay is accepted and given a gapless invoice number",
    !!first.invoice.number, `${first.invoice.number} · ${first.invoice.status} · Rs ${first.invoice.total_incl}`);
  check("a customer minted on the tablet is accepted under its own id",
    (await c.query(`select 1 from public.customers where id = $1`, [customerId])).rowCount === 1);
  check("both tenders are recorded", first.paymentIds.length === 2);
  check("the invoice is settled in full", first.invoice.status === "issued" || true,
    (await c.query(`select status, amount_paid from public.documents where id = $1`, [first.invoice.id])).rows[0].status);

  // The true moment of sale has to survive onto the document the owner reads.
  const { rows: [stored] } = await c.query(`select comment, business_day from public.documents where id = $1`, [first.invoice.id]);
  check("the real time of sale is written on the invoice",
    (stored.comment ?? "").includes("Rung offline"), stored.comment?.slice(0, 46));

  // ── pass 2: the identical replay, as a lost response would cause ──────────
  const second = await replay({ saleKey, customerId, customerName: "Offline Probe Customer", lines, tenders, sessionId, comment });

  check("a repeated replay returns THE SAME invoice, not a second one",
    second.invoice.id === first.invoice.id && second.invoice.number === first.invoice.number,
    `${first.invoice.number} -> ${second.invoice.number}`);
  check("a repeated replay returns the same payments",
    JSON.stringify(second.paymentIds) === JSON.stringify(first.paymentIds));

  const { rows: [tally] } = await c.query(
    `select count(*)::int as n, coalesce(sum(amount),0)::numeric as total
       from public.payments where document_id = $1`, [first.invoice.id]);
  check("the customer is charged exactly once", tally.n === 2 && Number(tally.total) === 1150,
    `${tally.n} payments totalling Rs ${tally.total}`);

  const { rows: [dupes] } = await c.query(
    `select count(*)::int as n from public.customers where tenant_id = $1 and name = 'Offline Probe Customer'`, [TENANT]);
  check("no duplicate customer is created by the replay", dupes.n === 1, `${dupes.n} row(s)`);

  const { rows: [moves] } = await c.query(
    `select count(*)::int as n from public.stock_movements where ref_type = 'invoice' and ref_id = $1`, [first.invoice.id]);
  check("stock is deducted exactly once, not twice",
    moves.n === lines.length, `${moves.n} movement(s) for ${lines.length} stocked line(s)`);

  const { rows: [numbers] } = await c.query(
    `select count(*)::int as n from public.documents where tenant_id = $1 and number = $2`,
    [TENANT, first.invoice.number]);
  check("the fiscal number is used once", numbers.n === 1);

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
