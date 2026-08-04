// Rolled-back check: a line added to a BILL at the counter reaches the invoice whole.
//
// The tablet used to build the bill's payload separately from the quote's — a thinner copy
// that hard-coded `description` to null and never sent `unit_label`. The bill now sends what
// a quote line sends, so this proves save_draft stores all of it on an INVOICE (the quote
// path was already covered; nothing had ever written these three fields onto a bill).
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
try {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: AUTH, role: "authenticated" })]);

  const tenant = (await c.query("select app.current_tenant_id() as t")).rows[0].t;
  const customer = (await c.query("select id from public.customers where tenant_id = $1 order by created_at limit 1", [tenant])).rows[0].id;

  const rich = {
    schemaVersion: 1,
    blocks: [{ type: "ul", items: [[{ text: "Applied by hand" }], [{ text: "Buffed off after 20 min" }]] }],
  };

  const doc = {
    id: null, doc_type: "invoice", customer_id: customer, vehicle_id: null, template_id: null,
    template_overrides: {}, valid_until: null, due_date: null, origin: "standalone",
    discount_kind: null, discount_value: 0,
  };
  const lines = [
    // came across from the quote — priced and agreed
    {
      product_id: null, title: "BODY POLISH", description: null, description_richtext: null,
      unit_label: null, qty: 1, unit_price: 11478.26, discount_pct: 0, discount_kind: "percent",
      discount_amount: 0, vat_rate: 15, sort_order: 0, line_kind: "service",
    },
    // picked up at the counter while the car was in
    {
      product_id: null, title: "Ceramic wax", description: "- Applied by hand\n- Buffed off after 20 min",
      description_richtext: rich, unit_label: "bottle", qty: 2, unit_price: 739.13,
      discount_pct: 10, discount_kind: "percent", discount_amount: 0, vat_rate: 15,
      sort_order: 1, line_kind: "product",
    },
  ];

  // save_draft hands back the whole document row, not an id.
  const id = (await c.query(
    "with d as (select public.save_draft($1::jsonb, $2::jsonb) as r) select (r).id as id from d",
    [JSON.stringify(doc), JSON.stringify(lines)],
  )).rows[0].id;

  const got = (await c.query(
    `select title, description, description_richtext, unit_label, qty, discount_pct, line_kind
       from public.document_lines where document_id = $1 order by sort_order`,
    [id],
  )).rows;

  console.log("a bill line keeps what it says it includes");
  check("lines stored", got.length, 2);
  check("quoted line kind", got[0].line_kind, "service");
  check("quoted line has no description", got[0].description, null);

  const wax = got[1];
  check("added line title", wax.title, "Ceramic wax");
  check("added line kind", wax.line_kind, "product");
  check("unit label", wax.unit_label, "bottle");
  check("qty", Number(wax.qty), 2);
  check("line discount", Number(wax.discount_pct), 10);
  check("flat description", wax.description, "- Applied by hand\n- Buffed off after 20 min");
  // jsonb reorders keys — compare the tree, not the text of it.
  const sorted = (v) => JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]))
      : x);
  check("richtext survives", sorted(wax.description_richtext), sorted(rich));
  check("bullets readable", JSON.stringify(wax.description_richtext).includes("Buffed off after 20 min"), "true");

  // …and it still issues, so nothing above is only true of a draft.
  const issued = (await c.query("select * from public.issue_document($1::uuid, null, $2, null)", [id, `probe:${id}`])).rows[0];
  check("the bill issues", /\S/.test(String(issued?.number ?? "")), "true");
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — rolled back" : `\n${failures} FAILED — rolled back`);
process.exit(failures === 0 ? 0 : 1);
