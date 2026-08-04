// Rolled-back verification for 20260804000020_a_line_knows_if_it_is_work.sql.
//
// A hand-typed line now says whether it is WORK or GOODS, because nothing else can, and
// the answer decides whether an accepted quote puts a car on the jobs board. What has to
// hold: save_draft stores what the builders state, the copiers carry it forward, the two
// placeholder lines the app writes itself say 'service', and a catalogue line stays NULL
// so products.kind keeps answering for it.
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
  const catalogue = (await c.query(
    "select id, kind, selling_price from public.products where tenant_id = $1 and kind = 'product' order by created_at limit 1",
    [tenant],
  )).rows[0];

  const doc = {
    id: null, doc_type: "quote", customer_id: customer, vehicle_id: null, template_id: null,
    template_overrides: {}, valid_until: null, due_date: null, origin: "standalone",
    discount_kind: null, discount_value: 0,
  };
  const mk = (title, over) => ({
    product_id: null, title, description: null, qty: 1, unit_price: 500, discount_pct: 0,
    discount_kind: "percent", discount_amount: 0, vat_rate: 15, ...over,
  });

  console.log("▸ save_draft stores what the ad-hoc dialogs stated");
  const q = (await c.query("select * from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify(doc),
    JSON.stringify([
      mk("Headlight restoration", { sort_order: 0, line_kind: "service" }),
      mk("Bottle of sealant", { sort_order: 1, line_kind: "product" }),
      mk("Typed before the dialog asked", { sort_order: 2 }),
      mk(catalogue ? "From the catalogue" : "n/a", { sort_order: 3, product_id: catalogue?.id ?? null, line_kind: "service" }),
    ]),
  ])).rows[0];
  const kinds = (await c.query(
    "select title, line_kind from public.document_lines where document_id = $1 order by sort_order", [q.id],
  )).rows;
  check("a stated service is stored", kinds[0].line_kind, "service");
  check("a stated product is stored", kinds[1].line_kind, "product");
  check("an unstated line stays null", kinds[2].line_kind, "null");
  if (catalogue) check("a CATALOGUE line stays null — its product answers", kinds[3].line_kind, "null");

  console.log("▸ the effective kind, the way both apps read it");
  const eff = (await c.query(
    `select dl.title, coalesce(dl.line_kind, p.kind, 'service') as kind
       from public.document_lines dl
       left join public.products p on p.id = dl.product_id
      where dl.document_id = $1 order by dl.sort_order`, [q.id],
  )).rows;
  check("typed service reads service", eff[0].kind, "service");
  check("typed product reads product", eff[1].kind, "product");
  check("an old unstated line reads as work", eff[2].kind, "service");
  if (catalogue) check("the catalogue line reads its product's kind", eff[3].kind, catalogue.kind);

  console.log("▸ a revision keeps what was stated — it IS the quote, renegotiated");
  const rev = (await c.query("select * from public.revise_quote($1::uuid)", [q.id])).rows[0];
  const revKinds = (await c.query(
    "select line_kind from public.document_lines where document_id = $1 order by sort_order", [rev.id],
  )).rows.map((r) => r.line_kind ?? "null").join(",");
  check("revision kinds match", revKinds, `service,product,null,${catalogue ? "null" : "null"}`);

  console.log("▸ a duplicate keeps them too");
  const dup = (await c.query("select * from public.duplicate_document($1::uuid)", [q.id])).rows[0];
  const dupKinds = (await c.query(
    "select line_kind from public.document_lines where document_id = $1 order by sort_order", [dup.id],
  )).rows.map((r) => r.line_kind ?? "null").join(",");
  check("duplicate kinds match", dupKinds, revKinds);

  console.log("▸ the placeholder lines the app writes itself say what they are");
  // The RPC insists the car belongs to the customer, so take a real pair off the books.
  const vehicle = (await c.query(
    "select id, customer_id from public.vehicles where tenant_id = $1 and customer_id is not null limit 1", [tenant],
  )).rows[0];
  if (vehicle) {
    const intake = (await c.query(
      "select * from public.create_intake_quote($1::uuid, null, null, $2::uuid, null, null, $3, null, null)",
      [vehicle.customer_id, vehicle.id, "Full detail"],
    )).rows[0];
    const k = (await c.query("select line_kind from public.document_lines where document_id = $1", [intake.id])).rows[0];
    check("reception's intake quote line is work", k.line_kind, "service");
  } else {
    console.log("  – no vehicle on file to raise an intake quote from; skipped");
  }
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — nothing persisted (rolled back)." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
