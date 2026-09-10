-- A credited bill is retired.
--
-- The tablet's "+ Invoice" on JOB-9F23 refused with the guard's own wording:
-- TESTINV-0119 "is still standing", "raise a credit note against it first".
-- The credit note had already been raised (TESTCN-0002, issued, the full
-- Rs 18,150.01) — money back with the customer, revenue reversed — yet the
-- guard still counted the invoice as standing, because app.superseded_bills
-- only knows draft and void. The prescribed way out did not open the door.
--
-- So a fully-credited invoice now counts as retired, exactly the way a void
-- already does (see scripts/_verify-revise-a-billed-quote.mjs §6: "all of it
-- clears the moment the bill is retired"). Partial credit leaves a live
-- balance, so the bill still stands until the credit covers it in full.
-- Credit-note status mirrors the invoice rule: drafts and voids are not
-- fiscal, so only live ones retire anything.
create or replace function app.superseded_bills(p_document_id uuid)
returns setof public.documents
language sql stable security definer set search_path = public, pg_temp as $fn$
  select i.*
    from public.documents i
   where i.tenant_id = (select d.tenant_id from public.documents d where d.id = p_document_id)
     and i.doc_type = 'invoice'
     and i.status not in ('draft', 'void')
     and i.id <> p_document_id
     and i.job_id is null
     and not exists (select 1 from public.document_jobs dj where dj.document_id = i.id)
     and i.source_document_id in (select quote_id from app.revision_chain(p_document_id))
     -- A bill the shop has fully taken back is not standing: its revenue is
     -- reversed and nothing is owed on it. Anything short of the full amount
     -- leaves a live balance, so the bill still stands.
     and coalesce(
       (select sum(c.total_incl)
          from public.documents c
         where c.tenant_id = i.tenant_id
           and c.doc_type = 'credit_note'
           and c.status not in ('draft', 'void')
           and c.source_document_id = i.id),
       0) < i.total_incl
   order by i.created_at
$fn$;

comment on function app.superseded_bills(uuid) is
  'Live, job-less invoices raised from this document''s revision line, minus the ones fully taken back by credit note — the bills left standing, counted as revenue and owed by nobody.';
