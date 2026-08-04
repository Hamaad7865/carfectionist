// Rolled-back check: the customer who comes back to the counter a second time.
//
// convert_quote_to_invoice is idempotent per quote — it hands back the ONE invoice that
// quote has — and once that invoice is issued it is frozen. So the tablet cannot add to it;
// the next thing they pick up has to be a bill of its own. This proves both halves:
// converting again really does return the same, already-issued document, and a fresh
// standalone invoice for the same customer issues with its own gapless number.
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

try {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: AUTH, role: "authenticated" })]);

  const tenant = (await c.query("select app.current_tenant_id() as t")).rows[0].t;
  const customer = (await c.query("select id from public.customers where tenant_id = $1 order by created_at limit 1", [tenant])).rows[0].id;

  const base = {
    id: null, customer_id: customer, vehicle_id: null, template_id: null, template_overrides: {},
    valid_until: null, due_date: null, origin: "standalone", discount_kind: null, discount_value: 0,
  };
  const mk = (title, price, kind) => ([{
    product_id: null, title, description: null, description_richtext: null, unit_label: null,
    qty: 1, unit_price: price, discount_pct: 0, discount_kind: "percent", discount_amount: 0,
    vat_rate: 15, sort_order: 0, line_kind: kind,
  }]);

  // the quote, billed and paid for at the counter
  const quote = await saveDraft({ ...base, doc_type: "quote" }, mk("BODY POLISH", 11478.26, "service"));
  const first = (await c.query("select * from public.convert_quote_to_invoice($1::uuid)", [quote])).rows[0];
  const firstIssued = (await c.query("select * from public.issue_document($1::uuid, null, $2, null)", [first.id, `inv:${first.id}`])).rows[0];

  console.log("the customer comes back for something else");
  check("the quote's bill has a number", /\S/.test(String(firstIssued.number ?? "")), "true");

  // …and it is frozen. Converting again is what the tablet does when the button is
  // pressed a second time, and it must not silently hand back something addable.
  const again = (await c.query("select * from public.convert_quote_to_invoice($1::uuid)", [quote])).rows[0];
  check("converting again returns the same invoice", again.id, first.id);
  check("and it is already issued", again.status, "issued");

  // so the extras become a bill of their own, created only when it is issued
  const second = await saveDraft({ ...base, doc_type: "invoice" }, mk("Ceramic wax", 739.13, "product"));
  check("the second bill is a fresh document", second !== first.id, "true");
  check("and starts as a draft", (await c.query("select status from public.documents where id = $1", [second])).rows[0].status, "draft");

  const secondIssued = (await c.query("select * from public.issue_document($1::uuid, null, $2, null)", [second, `inv:${second}`])).rows[0];
  check("it gets its own number", secondIssued.number !== firstIssued.number, "true");
  check("numbered next, with no gap", Number(String(secondIssued.number).replace(/\D/g, "")), Number(String(firstIssued.number).replace(/\D/g, "")) + 1);
  check("it carries only the extras", Number(secondIssued.total_incl), 850);

  // the first bill is untouched by any of it
  const firstNow = (await c.query("select number, status, total_incl from public.documents where id = $1", [first.id])).rows[0];
  check("the first bill still stands", firstNow.number, firstIssued.number);
  check("with its own total", Number(firstNow.total_incl), 13200);

  // and both are waiting to be collected — neither was paid by issuing it
  const owed = (await c.query(
    "select count(*)::int as n from public.documents where id = any($1::uuid[]) and status = 'issued' and amount_paid = 0",
    [[first.id, second]],
  )).rows[0].n;
  check("both bills wait in TO COLLECT", owed, 2);
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — rolled back" : `\n${failures} FAILED — rolled back`);
process.exit(failures === 0 ? 0 : 1);
