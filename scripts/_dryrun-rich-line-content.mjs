// Applies 20260804000020_lines_carry_rich_content.sql inside a transaction, drives
// rich content and unit_label through save_draft, asserts the jsonb landed as an
// OBJECT (not a stringified blob) and that both guards bite, then ROLLS BACK.
// Nothing is kept.
//   node scripts/_dryrun-rich-line-content.mjs
import pg from "pg";
import fs from "node:fs";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner auth uid)
const sql = fs.readFileSync("supabase/migrations/20260804000020_lines_carry_rich_content.sql", "utf8");

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};

// The owner's real quote line, as the editor will send it.
const DIAMONDBRITE = {
  schemaVersion: 1,
  blocks: [
    {
      type: "ul",
      items: [
        [{ text: "Full Vehicle decontamination" }],
        [{ text: "Paint Correction ( 1 - 5 Step polishing depending on surface damages)" }],
        [{ text: "Ceramic Coating 3 years protection on body only" }],
        [{ text: "Plastic treatment and restoration" }],
      ],
    },
  ],
};
const FLAT =
  "- Full Vehicle decontamination\n" +
  "- Paint Correction ( 1 - 5 Step polishing depending on surface damages)\n" +
  "- Ceramic Coating 3 years protection on body only\n" +
  "- Plastic treatment and restoration";

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");

  await c.query(sql);
  console.log("✓ migration applied without error");

  const cols = (
    await c.query(
      `select column_name, data_type, is_nullable from information_schema.columns
        where table_name='document_lines' and column_name in ('description_richtext','unit_label')
        order by column_name`,
    )
  ).rows;
  check("description_richtext is jsonb", cols.find((r) => r.column_name === "description_richtext")?.data_type, "jsonb");
  check("description_richtext nullable", cols.find((r) => r.column_name === "description_richtext")?.is_nullable, "YES");
  check("unit_label is text", cols.find((r) => r.column_name === "unit_label")?.data_type, "text");

  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: AUTH, role: "authenticated" })]);

  // ── the round trip ─────────────────────────────────────────────────────────
  const q = (
    await c.query("select id from public.save_draft($1::jsonb, $2::jsonb, null)", [
      JSON.stringify({ doc_type: "quote" }),
      JSON.stringify([
        {
          title: "Diamondbrite 3 YEARS PROTECTION Exterior only",
          description: FLAT,
          description_richtext: DIAMONDBRITE,
          unit_label: "panels",
          qty: 1,
          unit_price: 26465.02,
          vat_rate: 15,
        },
        { title: "Sunroof Waterspot treatment", qty: 1, unit_price: 869.57, vat_rate: 15 },
      ]),
    ])
  ).rows[0];

  const lines = (
    await c.query(
      `select title, description, unit_label,
              jsonb_typeof(description_richtext) as rt_type,
              description_richtext#>>'{blocks,0,items,1,0,text}' as second_bullet,
              (description_richtext->>'schemaVersion')::int as ver
         from public.document_lines where document_id=$1 order by sort_order`,
      [q.id],
    )
  ).rows;

  // THE check this probe exists for. ->> would have stored the serialised text and
  // looked perfectly fine until someone queried it.
  check("rich content stored as a jsonb OBJECT, not a string", lines[0].rt_type, "object");
  check("schemaVersion survived", lines[0].ver, 1);
  check(
    "a nested bullet is queryable in SQL",
    lines[0].second_bullet,
    "Paint Correction ( 1 - 5 Step polishing depending on surface damages)",
  );
  check("flat-text mirror stored in description", lines[0].description, FLAT);
  check("unit_label stored", lines[0].unit_label, "panels");

  // A line that carries neither must still be exactly as it was before today.
  check("line without rich content → null", lines[1].rt_type, null);
  check("line without unit → null", lines[1].unit_label, null);

  // ── the guards ─────────────────────────────────────────────────────────────
  await c.query("savepoint g1");
  try {
    await c.query(
      `insert into public.document_lines (tenant_id, document_id, title, qty, unit_price, vat_rate, unit_label)
       select tenant_id, id, 'x', 1, 1, 15, repeat('y', 25) from public.documents where id=$1`,
      [q.id],
    );
    check("a 25-char unit_label is refused", "allowed", "rejected");
  } catch {
    check("a 25-char unit_label is refused", "rejected", "rejected");
  }
  await c.query("rollback to savepoint g1");

  await c.query("savepoint g2");
  try {
    const huge = { schemaVersion: 1, blocks: [{ type: "p", runs: [{ text: "z".repeat(21000) }] }] };
    await c.query(
      `insert into public.document_lines (tenant_id, document_id, title, qty, unit_price, vat_rate, description_richtext)
       select tenant_id, id, 'x', 1, 1, 15, $2::jsonb from public.documents where id=$1`,
      [q.id, JSON.stringify(huge)],
    );
    check("a 21KB rich document is refused", "allowed", "rejected");
  } catch {
    check("a 21KB rich document is refused", "rejected", "rejected");
  }
  await c.query("rollback to savepoint g2");

  // ── the bug this branch exists for ─────────────────────────────────────────
  // The desk writes a description; the tablet then re-saves the same quote.
  // save_draft deletes every line and re-inserts from the payload, so if the
  // tablet's payload omits the description, the description is gone. This replays
  // the EXACT json quoteLineJson() now produces — pinned by QuoteLineWireTest —
  // rather than a hand-written approximation of it.
  const tabletPayload = [
    {
      product_id: null,
      title: "Diamondbrite 3 YEARS PROTECTION Exterior only",
      description: FLAT,
      description_richtext: DIAMONDBRITE,
      unit_label: null,
      qty: 1,
      unit_price: 26465.02,
      discount_pct: 0,
      discount_kind: "percent",
      discount_amount: 0,
      vat_rate: 15,
      sort_order: 0,
    },
  ];
  await c.query("select public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ id: q.id, doc_type: "quote" }),
    JSON.stringify(tabletPayload),
  ]);
  const afterTablet = (
    await c.query(
      `select jsonb_typeof(description_richtext) rt, description,
              description_richtext#>>'{blocks,0,items,3,0,text}' as last_bullet
         from public.document_lines where document_id=$1 order by sort_order`,
      [q.id],
    )
  ).rows[0];
  check("a tablet re-save keeps the rich description", afterTablet.rt, "object");
  check("a tablet re-save keeps the flat mirror", afterTablet.description, FLAT);
  check("the fourth bullet is still there afterwards", afterTablet.last_bullet, "Plastic treatment and restoration");

  // And the shape the tablet USED to send, to show the probe would have caught it.
  await c.query("savepoint old");
  await c.query("select public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ id: q.id, doc_type: "quote" }),
    JSON.stringify([{ ...tabletPayload[0], description: null, description_richtext: null }]),
  ]);
  const afterOld = (
    await c.query("select jsonb_typeof(description_richtext) rt from public.document_lines where document_id=$1", [q.id])
  ).rows[0];
  check("the OLD tablet payload would have erased it (proving the probe bites)", afterOld.rt, null);
  await c.query("rollback to savepoint old");

  // ── regression: a save with no new fields at all still works ───────────────
  const plain = (
    await c.query("select id from public.save_draft($1::jsonb, $2::jsonb, null)", [
      JSON.stringify({ doc_type: "quote" }),
      JSON.stringify([{ title: "Wash", qty: 1, unit_price: 300, vat_rate: 15 }]),
    ])
  ).rows[0];
  const before = (
    await c.query(
      "select jsonb_typeof(description_richtext) rt, unit_label, description from public.document_lines where document_id=$1",
      [plain.id],
    )
  ).rows[0];
  check("plain save_draft still works → rich null", before.rt, null);
  check("plain save_draft still works → description null", before.description, null);

  await c.query("rollback");
  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`} (rolled back — nothing persisted)`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  try { await c.query("rollback"); } catch {}
  console.error("✗ verify error:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
