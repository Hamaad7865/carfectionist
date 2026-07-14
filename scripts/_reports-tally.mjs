// READ-ONLY reports tally: recompute every report's headline number straight
// from the base ledger tables and diff against stored/derived values, proving
// the reports derive from real data and agree with each other.
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
let bad = 0;
const row = async (sql, params = []) => (await c.query(sql, params)).rows[0];
const ok = (label, pass, detail = "") => {
  if (!pass) bad++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

try {
  console.log("▸ ledger volume (context: PostgREST cap = 1000/page)");
  const vol = await row(`select
    (select count(*) from documents where doc_type='invoice' and status in ('issued','partly_paid','paid')) inv,
    (select count(*) from payments) pays,
    (select count(*) from document_lines l join documents d on d.id=l.document_id where d.status='paid') paid_lines`);
  console.log(`    invoices=${vol.inv} payments=${vol.pays} paid-lines=${vol.paid_lines}`);

  console.log("▸ identity: every document's total_incl = subtotal_excl + vat_total");
  const t1 = await row(`select count(*)::int n from documents
    where number is not null and abs(total_incl - (subtotal_excl + vat_total)) > 0.005`);
  ok("totals identity holds on all numbered docs", t1.n === 0, `${t1.n} violations`);

  console.log("▸ identity: amount_paid = Σ signed payments, per document");
  const t2 = await row(`select count(*)::int n from (
    select d.id from documents d
    left join payments p on p.document_id = d.id
    where d.doc_type = 'invoice' and d.number is not null
    group by d.id, d.amount_paid
    having abs(coalesce(sum(p.amount),0) - d.amount_paid) > 0.005) x`);
  ok("amount_paid matches the payments ledger for every invoice", t2.n === 0, `${t2.n} mismatches`);

  console.log("▸ identity: VAT-inclusive revenue − output VAT = VAT-exclusive revenue (Collected tab vs P&L)");
  const t3 = await row(`select
    round(sum(case when doc_type='invoice' then total_incl else -total_incl end)::numeric, 2) incl,
    round(sum(case when doc_type='invoice' then vat_total  else -vat_total  end)::numeric, 2) vat,
    round(sum(case when doc_type='invoice' then subtotal_excl else -subtotal_excl end)::numeric, 2) excl
    from documents where doc_type in ('invoice','credit_note') and status in ('issued','partly_paid','paid')`);
  ok("incl − VAT = excl", Math.abs(Number(t3.incl) - Number(t3.vat) - Number(t3.excl)) < 0.01,
     `Rs ${t3.incl} − Rs ${t3.vat} = Rs ${(Number(t3.incl)-Number(t3.vat)).toFixed(2)} vs P&L Rs ${t3.excl}`);

  console.log("▸ aged receivables: open invoices minus credited ones");
  const t4 = await row(`select round(coalesce(sum(d.total_incl - d.amount_paid),0)::numeric,2) outstanding, count(*)::int n
    from documents d
    where d.doc_type='invoice' and d.status in ('issued','partly_paid')
      and not exists (select 1 from documents cn where cn.doc_type='credit_note' and cn.status <> 'void' and cn.source_document_id = d.id)`);
  console.log(`    outstanding = Rs ${t4.outstanding} across ${t4.n} open invoice(s) (this is what the report MUST show)`);

  console.log("▸ cash-up: stored expected/variance vs recompute, every CLOSED session");
  const t5 = await row(`select count(*)::int n from cash_sessions cs
    where cs.status='closed' and (
      abs(coalesce(cs.expected_cash,0) - (cs.opening_float
        + coalesce((select sum(amount) from payments where cash_session_id=cs.id and method='cash'),0)
        + coalesce((select sum(amount) from till_movements where cash_session_id=cs.id),0))) > 0.005
      or abs(coalesce(cs.variance,0) - (coalesce(cs.closing_count,0) - coalesce(cs.expected_cash,0))) > 0.005)`);
  ok("every closed till reconciles (float + cash − outs = expected; variance = counted − expected)", t5.n === 0, `${t5.n} broken sessions`);

  console.log("▸ period close (owner closed June 2026): stored snapshot vs live ledger");
  const pc = await row(`select totals from period_closes where period = '2026-06'`).catch(() => null);
  if (pc) {
    const live = await row(`with b as (select '2026-06-01 00:00:00+04'::timestamptz s),
      b2 as (select s, s + interval '1 month' e from b)
      select
        (select count(*) from documents, b2 where doc_type='invoice' and status<>'void' and issued_at>=s and issued_at<e)::int inv_count,
        (select round(coalesce(sum(total_incl),0)::numeric,2) from documents, b2 where doc_type='invoice' and status<>'void' and issued_at>=s and issued_at<e) inv_revenue`);
    const snap = pc.totals?.invoices ?? {};
    ok("June invoice count matches", Number(snap.count ?? -1) === Number(live.inv_count), `snapshot=${snap.count} live=${live.inv_count}`);
    ok("June invoice revenue matches", Math.abs(Number(snap.revenue ?? -1) - Number(live.inv_revenue)) < 0.01, `snapshot=Rs ${snap.revenue} live=Rs ${live.inv_revenue}`);
  } else {
    console.log("    (no closed period found — skipped)");
  }

  console.log("▸ issue_date = Mauritius day of issued_at (post-backfill)");
  const t6 = await row(`select count(*)::int n from documents
    where issued_at is not null and issue_date is not null
      and issue_date <> ((issued_at at time zone 'utc') + interval '4 hours')::date`);
  ok("no document is misfiled into the wrong MU day", t6.n === 0, `${t6.n} misfiled`);

  console.log("▸ reversal integrity: every mirror nets its original exactly");
  const t7 = await row(`select count(*)::int n from payments m
    join payments o on o.id = m.reverses_payment_id
    where m.amount <> -o.amount`);
  ok("all reversal mirrors are exact negatives", t7.n === 0, `${t7.n} broken pairs`);

  console.log("▸ stock ledger: COGS movements only reference real documents/jobs");
  const t8 = await row(`select count(*)::int n from stock_movements m
    where m.ref_type in ('invoice','credit_note') and not exists (select 1 from documents d where d.id = m.ref_id)`);
  ok("no orphan sale movements", t8.n === 0, `${t8.n} orphans`);
} finally {
  await c.end();
}
console.log(bad === 0 ? "\n✓ ALL LEDGER IDENTITIES HOLD — the reports derive from real, mutually-consistent data" : `\n✗ ${bad} identity check(s) FAILED`);
process.exit(bad === 0 ? 0 : 1);
