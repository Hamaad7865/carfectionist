-- Drop the stale issue_document twin.
--
-- Same story as 20260810000015 (which dropped the stale create_and_issue_credit_note
-- twin): the 3-arg overload predates the day guard, replay ordering, discount guard,
-- Mauritius-day stamping, shop-floor deduction and tenant checks — the 4-arg overload
-- is newer than it in every respect. Worse, since the 4-arg session parameter has a
-- default, EVERY short call is now ambiguous: accepting a draft quote (accept_quote,
-- convert_quote_to_job, convert_quote_to_jobs) fails with "not unique" instead of
-- issuing, and so does any client still on the short form.
--
-- The canonical 4-arg stays; every live caller (tablet, web, RPCs) already names all
-- four parameters, and short positional calls now resolve to it with a null session
-- (back-office semantics: business_day is today).
drop function if exists public.issue_document(uuid, uuid, text);

-- Prove no short call can go ambiguous again: every remaining overload takes
-- all four arguments, so arity alone decides.
do $$
begin
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'issue_document' and p.pronargs < 4
  ) then
    raise exception 'a short issue_document overload is back — short calls are ambiguous again';
  end if;
end $$;
