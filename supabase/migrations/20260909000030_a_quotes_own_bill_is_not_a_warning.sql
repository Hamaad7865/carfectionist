-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a quote's OWN bill is not a warning
--
-- 20260909000010 gave the screens public.superseded_bills() so a bill left
-- standing by a revision could never again be invisible. It went one step too
-- wide: app.superseded_bills() includes the document's own line, itself
-- included, and that is exactly right for the GUARD — revising a quote billed
-- at the counter must be refused because of that quote's own bill.
--
-- For the SCREENS it is wrong. On an ordinary goods-only counter sale the quote
-- and its bill are the normal, finished shape of the transaction; the page
-- already says so through the flow strip and "Go to invoice". Reading the same
-- row back as "AN EARLIER BILL IS STILL STANDING — raised from a quotation this
-- one replaced" is false, and alarming about business that is perfectly in
-- order. Eleven quotes in the live tenant would have shown it (A00053/INV-0063,
-- A00066/INV-0082, A00070/INV-0089 …), none of them revised at all.
--
-- So the READ excludes the bill raised from the document being looked at, and
-- keeps every bill raised from a quote it supersedes. The guard is untouched:
-- app.superseded_bills() still sees the lot, and revise_quote / the bill path /
-- the issue trigger all still refuse exactly what they refused before.
--
--   • quote A00180  → INV-0204 (raised from A00179, superseded)  → shown
--   • quote A00179  → INV-0204 (raised from A00179, its own)     → not shown
--   • the Rs 1,650 draft, and job 7e86502e → INV-0204            → shown
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.superseded_bills(p_document_id uuid)
returns table (
  id uuid, number text, status public.doc_status,
  total_incl numeric, amount_paid numeric, issued_at timestamptz,
  quote_id uuid, quote_number text
)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select b.id, b.number, b.status, b.total_incl, b.amount_paid, b.issued_at,
         q.id, q.number
    from app.superseded_bills(p_document_id) b
    left join public.documents q on q.id = b.source_document_id
   where b.tenant_id = app.current_tenant_id()
     -- The document's OWN bill is its ordinary outcome, not a bill left behind.
     -- Only a bill raised from a quotation this one SUPERSEDES is a surprise.
     and b.source_document_id is distinct from p_document_id
$fn$;

revoke execute on function public.superseded_bills(uuid) from public;
revoke execute on function public.superseded_bills(uuid) from anon;
grant  execute on function public.superseded_bills(uuid) to authenticated;


-- ─── prove it, against what is actually installed ───────────────────────────
do $$
declare
  v_self int;
  v_acl  text;
begin
  -- No quote may be warned about a bill raised from itself, in any tenant.
  select count(*) into v_self
    from public.documents q
   cross join lateral public.superseded_bills(q.id) b
   where q.doc_type = 'quote' and b.quote_id = q.id;
  if v_self > 0 then
    raise exception '% quote(s) are still warned about their own bill', v_self;
  end if;

  -- ...while the guard still sees everything, or the refusals go quiet.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'superseded_bills'
  ) then
    raise exception 'app.superseded_bills is gone — the guards have nothing to ask';
  end if;

  select coalesce(proacl::text, '') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'superseded_bills';
  if v_acl like '%anon=X%' then
    raise exception 'public.superseded_bills is still executable by anon';
  end if;

  raise notice 'the screens warn only about a bill left standing by a REVISION; the guards still see every one';
end $$;

notify pgrst, 'reload schema';
