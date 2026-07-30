// Probe product_recent_activity against the live DB AS the owner — role switched
// and JWT claims set, so RLS and the grant are actually exercised rather than
// bypassed by the superuser connection the migration ran on.
//   node scripts/_verify-product-activity.mjs
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh
requireEnv("SUPABASE_DB_URL", DB_URL);

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

// Pick the probes as superuser (needs to see the whole catalogue to choose well).
const pick = async (sql) => (await c.query(sql)).rows[0] ?? null;

const stocked = await pick(`
  select p.id, p.name, count(m.id) as n
  from products p join stock_movements m on m.product_id = p.id
  where p.is_stocked group by p.id, p.name order by count(m.id) desc limit 1`);
const service = await pick(`
  select p.id, p.name, count(dl.id) as n
  from products p join document_lines dl on dl.product_id = p.id
  join documents d on d.id = dl.document_id and d.issued_at is not null and d.doc_type in ('invoice','credit_note')
  where p.kind = 'service' group by p.id, p.name order by count(dl.id) desc limit 1`);
const empty = await pick(`
  select p.id, p.name from products p
  where p.is_stocked and not exists (select 1 from stock_movements m where m.product_id = p.id) limit 1`);

// Now become a real signed-in owner.
await c.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: OWNER, role: "authenticated" })]);
await c.query("set role authenticated");

const call = async (id) => (await c.query("select * from product_recent_activity($1, 8)", [id])).rows;

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log(`\n── stocked: ${stocked.name} (${stocked.n} movements) ──`);
const a = await call(stocked.id);
console.table(a.map((r) => ({ when: r.happened_at, qty: r.qty, kind: r.kind, loc: r.location_name, doc: r.doc_number, party: r.party_name, by: r.actor_name })));
check("returns rows as the authenticated owner", a.length > 0, `${a.length} rows`);
check("never more than the requested 8", a.length <= 8);
check("newest first", a.every((r, i) => i === 0 || new Date(a[i - 1].happened_at) >= new Date(r.happened_at)));
check("every row says where it happened", a.every((r) => r.location_name));
check("every row is a movement", a.every((r) => r.source === "movement"));
const sales = a.filter((r) => r.kind === "invoice");
check("sales carry a document number and id to link to", sales.every((r) => r.doc_number && r.ref_id), `${sales.length} sales`);
const transfers = a.filter((r) => r.kind === "transfer");
if (transfers.length) check("transfers name their other end", transfers.every((r) => r.party_name));
const adj = a.filter((r) => r.kind === "adjustment");
if (adj.length) check("adjustments carry their reason", adj.every((r) => r.note));

if (service) {
  console.log(`\n── service: ${service.name} (${service.n} billed lines) ──`);
  const s = await call(service.id);
  console.table(s.map((r) => ({ when: r.happened_at, qty: r.qty, source: r.source, kind: r.kind, doc: r.doc_number, party: r.party_name })));
  check("a service falls back to its billed lines", s.length > 0, `${s.length} rows`);
  check("marked as lines, not movements", s.every((r) => r.source === "line"));
  check("no location on a service", s.every((r) => r.location_name === null));
  check("each line links to its document", s.every((r) => r.ref_id && r.doc_number));
} else {
  console.log("\n── no service has been billed yet; skipping that branch ──");
}

if (empty) {
  console.log(`\n── never moved: ${empty.name} ──`);
  const e = await call(empty.id);
  check("a product with no history returns nothing (not an error)", e.length === 0);
}

console.log("\n── unknown id ──");
check("an id that isn't a product returns nothing", (await call("00000000-0000-4000-8000-000000000000")).length === 0);

await c.end();
console.log(failures ? `\n✗ ${failures} check(s) failed` : "\n✓ all checks passed");
process.exitCode = failures ? 1 : 0;
