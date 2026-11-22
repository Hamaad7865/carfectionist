// Proves that the pre-two-company web RPC payloads still work on today's schema.
// The TEST Sandbox is impersonated inside one BEGIN/ROLLBACK; no row or number is kept.
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-reverted-web-db-compat.mjs
import pg from "pg";
import { randomUUID } from "node:crypto";

const SANDBOX = "22222222-2222-4222-8222-000000000002";
const OWNER = "b729191b-1159-4d46-88c7-3c9aceb5e664";
const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) throw new Error("SUPABASE_DB_URL is required");

const c = new pg.Client({ connectionString: DB_URL });
let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const one = async (sql, params = []) => (await c.query(sql, params)).rows[0];
const asOwner = async () => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: OWNER, role: "authenticated" }),
  ]);
};
const asAdmin = () => c.query("reset role");

await c.connect();
try {
  await c.query("begin");
  await c.query("set local lock_timeout = '5s'");

  const entity = await one(
    `select id, quote_prefix, quote_next_number, quote_number_padding,
            invoice_prefix, invoice_next_number, invoice_number_padding,
            credit_note_prefix, credit_note_next_number, credit_note_number_padding
       from public.legal_entities
      where tenant_id = $1 and is_default`,
    [SANDBOX],
  );
  if (!entity) throw new Error("sandbox default company is missing");
  const product = await one(
    `select id from public.products
      where tenant_id = $1 and is_active
        and (legal_entity_id is null or legal_entity_id = $2)
      order by id limit 1`,
    [SANDBOX, entity.id],
  );
  if (!product) throw new Error("sandbox has no product for its default company");
  const customer = await one(
    `select c.id, v.id as vehicle_id
       from public.customers c
       join public.vehicles v on v.customer_id = c.id and v.tenant_id = c.tenant_id and v.is_active
      where c.tenant_id = $1
      order by c.id, v.id
      limit 1`,
    [SANDBOX],
  );
  if (!customer) throw new Error("sandbox has no customer and active vehicle to invoice");

  await c.query(
    `update public.trading_days
        set status = 'open'
      where tenant_id = $1 and business_date = app.mu_today() and status = 'closed'`,
    [SANDBOX],
  );
  await c.query(
    `update public.cash_sessions
        set status = 'closed', closed_at = now()
      where tenant_id = $1 and status = 'open'`,
    [SANDBOX],
  );
  await asOwner();
  const till = await one("select (public.back_office_till()).id");

  const line = {
    product_id: product.id,
    vehicle_id: null,
    title: "Rollback compatibility",
    description: null,
    description_richtext: null,
    unit_label: null,
    qty: 1,
    unit_price: 100,
    discount_pct: 0,
    discount_kind: "percent",
    discount_amount: 0,
    vat_rate: 15,
    sort_order: 0,
    line_kind: "service",
    price_includes_vat: false,
  };
  const quoteId = randomUUID();
  const quote = await one(
    "select id from public.save_draft($1::jsonb, $2::jsonb, null)",
    [
      JSON.stringify({ id: quoteId, doc_type: "quote", customer_id: customer.id, vehicle_id: null, origin: "standalone" }),
      JSON.stringify([line]),
    ],
  );
  const quoteNumber = `${entity.quote_prefix}${String(entity.quote_next_number).padStart(entity.quote_number_padding, "0")}`;
  const issuedQuote = await one(
    `select id, number, legal_entity_id
       from public.issue_document(
         p_document_id => $1,
         p_stock_location_id => null,
         p_idempotency_key => $2,
         p_session_id => $3
       )`,
    [quote.id, "revert-compat:quote", till.id],
  );
  check("issue_document keeps the old web argument names", issuedQuote.number, quoteNumber);
  check("a line with no company resolves to the default company", issuedQuote.legal_entity_id, entity.id);

  const invoice = await one(
    "select id from public.convert_quote_to_invoice(p_quote_id => $1)",
    [issuedQuote.id],
  );
  const invoiceNumber = `${entity.invoice_prefix}${String(entity.invoice_next_number).padStart(entity.invoice_number_padding, "0")}`;
  const issuedInvoice = await one(
    `select id, number, total_incl
       from public.issue_document(
         p_document_id => $1,
         p_stock_location_id => null,
         p_idempotency_key => $2,
         p_session_id => $3
       )`,
    [invoice.id, "revert-compat:invoice", till.id],
  );
  check("convert_quote_to_invoice keeps its old call shape", issuedInvoice.number, invoiceNumber);

  await one(
    `select id from public.record_payment(
       p_invoice_id => $1,
       p_method => 'cash',
       p_amount => $2,
       p_tendered => $2,
       p_external_ref => null,
       p_cash_session_id => $3,
       p_idempotency_key => $4
     )`,
    [issuedInvoice.id, issuedInvoice.total_incl, till.id, "revert-compat:payment"],
  );
  const paid = await one(
    "select status, amount_paid from public.documents where id = $1",
    [issuedInvoice.id],
  );
  check("record_payment still accepts cashSessionId", `${paid.status} ${paid.amount_paid}`, `paid ${issuedInvoice.total_incl}`);

  const creditNumber = `${entity.credit_note_prefix}${String(entity.credit_note_next_number).padStart(entity.credit_note_number_padding, "0")}`;
  const credit = await one(
    `select id, number, legal_entity_id
       from public.create_and_issue_credit_note(
         p_invoice_id => $1,
         p_stock_location_id => null,
         p_restock => false,
         p_session_id => $2
       )`,
    [issuedInvoice.id, till.id],
  );
  check("credit note keeps the old call shape and series", `${credit.number} ${credit.legal_entity_id}`, `${creditNumber} ${entity.id}`);

  const discardId = randomUUID();
  await one(
    "select id from public.save_draft($1::jsonb, $2::jsonb, null)",
    [
      JSON.stringify({ id: discardId, doc_type: "quote", customer_id: customer.id, vehicle_id: null, origin: "standalone" }),
      JSON.stringify([line]),
    ],
  );
  await c.query("select public.discard_draft(p_document_id => $1)", [discardId]);
  check(
    "discard_draft still accepts the old raw call",
    (await one("select count(*)::int n from public.documents where id = $1", [discardId])).n,
    0,
  );

  const billedJob = async (tag) => {
    const qid = randomUUID();
    await one(
      "select id from public.save_draft($1::jsonb, $2::jsonb, null)",
      [
        JSON.stringify({
          id: qid,
          doc_type: "quote",
          customer_id: customer.id,
          vehicle_id: customer.vehicle_id,
          origin: "standalone",
        }),
        JSON.stringify([{ ...line, product_id: null, title: `Rollback job ${tag}` }]),
      ],
    );
    const job = await one(
      `select id from public.convert_quote_to_job(
         p_quote_id => $1,
         p_technician_id => null,
         p_scheduled_at => null
       )`,
      [qid],
    );
    const bill = await one(
      `select id from public.create_document_from_job(
         p_job_id => $1,
         p_doc_type => 'invoice'
       )`,
      [job.id],
    );
    const issued = await one(
      `select id, total_incl from public.issue_document(
         p_document_id => $1,
         p_stock_location_id => null,
         p_idempotency_key => $2,
         p_session_id => $3
       )`,
      [bill.id, `revert-compat:${tag}:issue`, till.id],
    );
    await one(
      `select id from public.record_payment(
         p_invoice_id => $1,
         p_method => 'cash',
         p_amount => $2,
         p_tendered => $2,
         p_external_ref => null,
         p_cash_session_id => $3,
         p_idempotency_key => $4
       )`,
      [issued.id, issued.total_incl, till.id, `revert-compat:${tag}:payment`],
    );
    return { jobId: job.id, billId: issued.id };
  };

  const readyJob = await billedJob("delivery");
  await asAdmin();
  await c.query("update public.jobs set status = 'ready' where id = $1", [readyJob.jobId]);
  await asOwner();
  check(
    "deliver_paid_job still accepts the old raw call",
    (await one("select public.deliver_paid_job(p_job_id => $1) as ok", [readyJob.jobId])).ok,
    true,
  );

  const inProgressJob = await billedJob("handback");
  await asAdmin();
  await c.query("update public.jobs set status = 'in_progress' where id = $1", [inProgressJob.jobId]);
  await asOwner();
  check(
    "hand_back_paid_job still accepts the old raw call",
    (await one("select public.hand_back_paid_job(p_job_id => $1) as ok", [inProgressJob.jobId])).ok,
    true,
  );

  const cancelQuoteId = randomUUID();
  await one(
    "select id from public.save_draft($1::jsonb, $2::jsonb, null)",
    [
      JSON.stringify({
        id: cancelQuoteId,
        doc_type: "quote",
        customer_id: customer.id,
        vehicle_id: customer.vehicle_id,
        origin: "standalone",
      }),
      JSON.stringify([{ ...line, product_id: null, title: "Rollback cancellation" }]),
    ],
  );
  const cancelJob = await one(
    `select id from public.convert_quote_to_job(
       p_quote_id => $1,
       p_technician_id => null,
       p_scheduled_at => null
     )`,
    [cancelQuoteId],
  );
  const cancelled = await one(
    `select status from public.cancel_job(
       p_job_id => $1,
       p_reason => 'rollback compatibility',
       p_restock => true,
       p_session_id => $2
     )`,
    [cancelJob.id, till.id],
  );
  check("cancel_job still accepts the old raw call", cancelled.status, "cancelled");

  const z = (await one(
    "select app.z_totals($1, $2, null, now()) as totals",
    [SANDBOX, till.id],
  )).totals;
  check("the Z report still computes after the entity splices", Number(z.tickets) >= 1, true);

  const closingCash = Number(
    (await one(
      `select coalesce(sum(amount), 0) n
         from public.payments
        where tenant_id = $1 and booked_session_id = $2 and method = 'cash'`,
      [SANDBOX, till.id],
    )).n,
  );
  const zReport = await one(
    `select id, number
       from public.close_service(
         p_session_id => $1,
         p_counted_cash => $2,
         p_remit => '{}',
         p_note => 'rollback compatibility'
       )`,
    [till.id, closingCash],
  );
  check("close_service still uses the reverted web arguments", Boolean(zReport.number), true);

  await asAdmin();
  const month = await one(
    `select to_char(
       max(issued_at at time zone 'Indian/Mauritius'),
       'YYYY-MM'
     ) m
       from public.documents
      where tenant_id = $1
        and doc_type = 'invoice'
        and issued_at < date_trunc('month', now() at time zone 'Indian/Mauritius')`,
    [SANDBOX],
  );
  if (!month?.m) throw new Error("sandbox has no prior month to close");
  await c.query(
    "delete from public.period_closes where tenant_id = $1 and period = $2",
    [SANDBOX, month.m],
  );
  await asOwner();
  const closed = await one(
    "select id, period from public.close_period(p_period => $1)",
    [month.m],
  );
  check("close_period still accepts the old web argument list", closed.period, month.m);
} catch (e) {
  failures++;
  console.error(`✗ aborted: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

console.log(failures ? `\n${failures} FAILED (rolled back)` : "\nALL GOOD (rolled back — nothing kept)");
process.exitCode = failures ? 1 : 0;
