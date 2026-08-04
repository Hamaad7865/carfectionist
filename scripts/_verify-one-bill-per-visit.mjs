// Rolled-back check: one visit, one bill.
//
// A customer having a service walks the shop three times and picks something up each time.
// That is ONE bill that grows, not three invoices — so the tablet saves the extras onto the
// quote's DRAFT invoice and leaves it a draft, and Checkout issues it when the money is
// actually taken. What has to hold:
//
//   · convert_quote_to_invoice hands back the SAME draft every time it is asked
//   · save_draft on that draft keeps its link to the quote, its job and its discount
//   · the extras accumulate — nothing the earlier trip added is lost
//   · issuing it numbers it ONCE, and after that it refuses to be added to
//
// Runs as `authenticated` impersonating the owner, then ROLLS BACK — nothing persists.
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
const saveDraft = async (doc, lines) =>
  (await c.query("with d as (select public.save_draft($1::jsonb, $2::jsonb) as r) select (r).id as id from d", [
    JSON.stringify(doc), JSON.stringify(lines),
  ])).rows[0].id;
const docRow = async (id) =>
  (await c.query(
    "select number, status, source_document_id, job_id, discount_kind, discount_value, total_incl from public.documents where id = $1",
    [id],
  )).rows[0];

try {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: AUTH, role: "authenticated" })]);

  const tenant = (await c.query("select app.current_tenant_id() as t")).rows[0].t;
  const customer = (await c.query("select id from public.customers where tenant_id = $1 order by created_at limit 1", [tenant])).rows[0].id;

  const line = (title, price, kind, sort) => ({
    product_id: null, title, description: null, description_richtext: null, unit_label: null,
    qty: 1, unit_price: price, discount_pct: 0, discount_kind: "percent", discount_amount: 0,
    vat_rate: 15, sort_order: sort, line_kind: kind,
  });

  // the quote the customer signed — a service, with 10% off the whole thing
  const quote = await saveDraft(
    {
      id: null, doc_type: "quote", customer_id: customer, vehicle_id: null, template_id: null,
      template_overrides: {}, valid_until: null, due_date: null, origin: "standalone",
      discount_kind: "percent", discount_value: 10,
    },
    [line("BODY POLISH", 11478.26, "service", 0)],
  );
  const quoteTotal = Number((await docRow(quote)).total_incl);

  console.log("one visit, one bill");

  // first trip to the counter
  const bill = (await c.query("select * from public.convert_quote_to_invoice($1::uuid)", [quote])).rows[0];
  check("the bill starts as a draft", bill.status, "draft");
  check("with no number yet", bill.number, null);
  check("and prices the same as the quote", Number(bill.total_incl), quoteTotal);

  const quoted = (await c.query("select * from public.document_lines where document_id = $1 order by sort_order", [bill.id])).rows;
  check("carrying the quote's line", quoted.length, 1);

  // …they pick up a bottle of wax. The tablet re-saves the WHOLE bill, quoted lines and all.
  const withWax = [line("BODY POLISH", 11478.26, "service", 0), line("Ceramic wax", 739.13, "product", 1)];
  await saveDraft({ id: bill.id, doc_type: "invoice", customer_id: customer, vehicle_id: null }, withWax);

  let now = await docRow(bill.id);
  check("still a draft", now.status, "draft");
  check("still linked to the quote", now.source_document_id, quote);
  check("and keeps the quote's discount", `${now.discount_kind} ${Number(now.discount_value)}`, "percent 10");

  // second trip — and the button hands back the SAME bill, not a new one
  const again = (await c.query("select * from public.convert_quote_to_invoice($1::uuid)", [quote])).rows[0];
  check("the same bill reopens", again.id, bill.id);
  const reopened = (await c.query("select title from public.document_lines where document_id = $1 order by sort_order", [bill.id])).rows;
  check("with the wax still on it", reopened.map((r) => r.title).join(" + "), "BODY POLISH + Ceramic wax");

  await saveDraft(
    { id: bill.id, doc_type: "invoice", customer_id: customer, vehicle_id: null },
    [...withWax, line("Air freshener", 217.39, "product", 2)],
  );
  const three = (await c.query("select count(*)::int n from public.document_lines where document_id = $1", [bill.id])).rows[0].n;
  check("three lines on one bill", three, 3);

  const bills = (await c.query(
    "select count(*)::int n from public.documents where doc_type = 'invoice' and source_document_id = $1 and status <> 'void'",
    [quote],
  )).rows[0].n;
  check("and it is still ONE invoice", bills, 1);

  // the money is taken at Checkout: that is what numbers it
  const issued = (await c.query("select * from public.issue_document($1::uuid, null, $2, null)", [bill.id, `inv:${bill.id}`])).rows[0];
  check("issuing gives it its number", /\S/.test(String(issued.number ?? "")), "true");
  check("and it is waiting to be collected", `${issued.status} ${Number(issued.amount_paid)}`, "issued 0");

  // after that it is frozen — the app must say so rather than quietly raise a second one
  const afterIssue = (await c.query("select * from public.convert_quote_to_invoice($1::uuid)", [quote])).rows[0];
  check("re-opening returns the issued bill", `${afterIssue.id === bill.id} ${afterIssue.status}`, "true issued");
  let refused = "no";
  try {
    await c.query("savepoint s");
    await saveDraft({ id: bill.id, doc_type: "invoice", customer_id: customer, vehicle_id: null }, withWax);
  } catch (e) {
    refused = /cannot edit an issued document/.test(e.message) ? "yes" : e.message;
  } finally {
    await c.query("rollback to savepoint s");
  }
  check("and nothing more can be added to it", refused, "yes");
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — rolled back" : `\n${failures} FAILED — rolled back`);
process.exit(failures === 0 ? 0 : 1);
