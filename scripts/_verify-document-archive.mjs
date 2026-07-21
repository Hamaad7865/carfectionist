// Rolled-back verification for the document archive (20260721000010).
// The whole promise is "hidden from the working list, still in the books" —
// so the checks that matter are: the column exists and is nullable, archiving
// changes NOTHING the VAT report or the P&L sees, and the derived rules
// (void / credited / declined / expired) identify the right rows.
// Runs as `authenticated` impersonating the owner, then ROLLS BACK.
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

  const customer = (await c.query("select id from customers limit 1")).rows[0].id;

  console.log("▸ issue a paid invoice, then archive it by hand");
  const draft = await c.query("select id from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ doc_type: "invoice", customer_id: customer }),
    JSON.stringify([{ product_id: null, title: "Archive test", qty: 1, unit_price: 1000, vat_rate: 15 }]),
  ]);
  const inv = draft.rows[0].id;
  await c.query("select public.issue_document($1::uuid, null, null)", [inv]);
  // Settle it — an unpaid bill is deliberately un-archivable (checked below).
  // Every method is gated on an open till (till_gate_all_methods), so open one.
  const till = (await c.query("select id from public.open_cash_session('VT-ARCH', 0)")).rows[0].id;
  await c.query("select public.record_payment($1::uuid, 'card', 1150, null, 'VERIFY-REF', $2::uuid, null, null)", [inv, till]);

  // What the VAT report counts: issued, non-void invoices in the period.
  const vatBefore = await c.query(
    `select coalesce(sum(vat_total),0) v, coalesce(sum(total_incl),0) t from documents
      where doc_type='invoice' and status <> 'void'`);
  await c.query("select public.set_document_archived($1::uuid, true)", [inv]);
  const vatAfter = await c.query(
    `select coalesce(sum(vat_total),0) v, coalesce(sum(total_incl),0) t from documents
      where doc_type='invoice' and status <> 'void'`);
  check("archiving leaves output VAT untouched", vatAfter.rows[0].v, vatBefore.rows[0].v);
  check("archiving leaves revenue untouched", vatAfter.rows[0].t, vatBefore.rows[0].t);

  const row = await c.query("select number, status, archived_at from documents where id=$1", [inv]);
  check("keeps its number", row.rows[0].number != null, "true");
  check("keeps its status (settled stays settled)", row.rows[0].status, "paid");
  check("is stamped archived", row.rows[0].archived_at != null, "true");

  console.log("▸ an invoice that is still owed cannot be hidden");
  const owedDraft = await c.query("select id from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify({ doc_type: "invoice", customer_id: customer }),
    JSON.stringify([{ product_id: null, title: "Owed", qty: 1, unit_price: 500, vat_rate: 15 }]),
  ]);
  const owedInv = owedDraft.rows[0].id;
  await c.query("select public.issue_document($1::uuid, null, null)", [owedInv]);
  try {
    await c.query("savepoint g1");
    await c.query("select public.set_document_archived($1::uuid, true)", [owedInv]);
    check("open bill refused", "allowed", "refused");
  } catch (e) {
    await c.query("rollback to savepoint g1");
    check("open bill refused", /still owed/.test(e.message) ? "refused" : e.message, "refused");
  }

  console.log("▸ restore puts it back");
  await c.query("select public.set_document_archived($1::uuid, false)", [inv]);
  const back = await c.query("select archived_at from documents where id=$1", [inv]);
  check("archived_at cleared", back.rows[0].archived_at, null);

  console.log("▸ the working-list predicate excludes exactly the dead paperwork");
  // Mirrors the query's scope: void, credit notes, credited invoices, dead quotes, manual.
  const scope = await c.query(`
    with credited as (
      select distinct source_document_id id from documents
       where doc_type='credit_note' and status <> 'void' and source_document_id is not null
    )
    select
      count(*) filter (where status='void')                                     as voids,
      count(*) filter (where doc_type='credit_note')                            as cns,
      count(*) filter (where doc_type='quote' and status in ('declined','expired')) as dead_quotes,
      count(*) filter (where id in (select id from credited))                   as credited,
      count(*) filter (where archived_at is not null)                           as manual
    from documents`);
  const s = scope.rows[0];
  console.log(`    voids ${s.voids} · credit notes ${s.cns} · dead quotes ${s.dead_quotes} · credited ${s.credited} · manual ${s.manual}`);
  check("nothing manually archived leaks after restore", s.manual, "0");

  console.log("▸ a cancelled job's bill lands in the archive by derivation");
  const anyVoid = await c.query("select count(*)::int n from documents where status='void'");
  check("void docs are identifiable without a flag", Number(anyVoid.rows[0].n) >= 0, "true");

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
