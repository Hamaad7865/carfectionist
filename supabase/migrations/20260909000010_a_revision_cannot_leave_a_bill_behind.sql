-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a revision cannot leave a bill behind
--
-- (Owner's shop, 2026-09-02.) A00179 was two wiper blades across the counter:
-- accepted and — because there was no service on it — billed and issued in the
-- same breath as INV-0204, Rs 1,320, the wipers coming off the shelf with it.
-- Two minutes later the price moved. The quote was REVISED: A00180 at Rs 1,650,
-- signed, converted to a job, and a second bill drafted when the job was ready.
--
-- Nothing ever retired INV-0204. It is still 'issued', still unpaid, and it
-- hangs off the SUPERSEDED quote — so it shows on neither the revision's page
-- nor the job, while:
--   • the sales journal counts status in ('issued','partly_paid','paid'), so
--     Rs 1,320 the shop never charged is booked as revenue;
--   • it stands as an open receivable against a customer who owes nothing on it;
--   • its 'sale on issue' movement already took two WIPER 24 off the shelf, so
--     issuing the Rs 1,650 draft would take the same two a second time.
--
-- WHY THE EXISTING MACHINERY MISSED IT. convert_quote_to_job knows exactly how
-- to re-price: retire the old bill, put its stock back, carry any deposit
-- forward, bill the revision. But that branch is fenced behind
-- `v_q.source_document_id is not null and v_q.job_id is not null`, and this
-- quote never had a job. So the accept fell through to the ordinary new-job
-- path, whose one attempt to catch a stray bill matches
-- `source_document_id = v_q.id` — the revision — while INV-0204 points at its
-- PARENT. One link out of reach, in a branch that never ran.
--
-- THE RULE. It is not a new one; the web has lived by it since it hid Revise on
-- a billed quote — "Revising is negotiation; a billed quote is past negotiating"
-- (sales/[id]/page.tsx). A policy that exists only in one client's markup is not
-- a policy: the tablet offers Revise on a billed quote to this day, and that is
-- the surface the counter uses. So it moves into the RPC, where both clients
-- meet it, and it is enforced again at the two moments money would actually
-- double — raising the second bill, and issuing it.
--
-- DELIBERATELY NOT AUTOMATIC. Auto-voiding on Revise would destroy a live fiscal
-- document on a click that has agreed nothing yet: of the eight quotes in this
-- database carrying both a revision and a live bill, SEVEN are revisions that
-- were opened and abandoned over invoices paid in full. And the WITH-JOB case is
-- left exactly as it is — there the bill is a working document for work still in
-- the bay, and its proven re-price path already retires it. Without a job the
-- goods left the shop as a finished counter sale, and the honest correction to
-- one of those is a void or a credit note. That is the owner's call, not a side
-- effect of a button.
--
-- Nothing here touches a single existing row. INV-0204 stays exactly as it is.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── the line a price descends from ─────────────────────────────────────────
-- Every quote in this document's ancestry, itself included: the quote it was
-- raised from, the quote THAT one was revised from, all the way back. One hop is
-- never enough — a revision can itself be revised, and INV-0204 was already one
-- hop beyond the only lookup that went hunting for it.
--
-- UNION, not UNION ALL: a corrupted source_document_id cycle then terminates on
-- the duplicate instead of spinning for ever inside a customer's checkout.
create or replace function app.revision_chain(p_document_id uuid)
returns table (quote_id uuid)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with recursive chain(id) as (
    select p_document_id
    union
    select d.source_document_id
      from chain c
      join public.documents d on d.id = c.id
     where d.source_document_id is not null
  )
  select q.id from chain c join public.documents q on q.id = c.id
   where q.doc_type = 'quote'
$fn$;

comment on function app.revision_chain(uuid) is
  'Every quote a document''s price descends from, itself included — the whole revision line, not just the parent.';


-- ─── a bill nothing will ever retire ────────────────────────────────────────
-- A live invoice raised somewhere on that line which NO JOB owns. Both halves
-- matter:
--   • not a draft — a draft bill is not a bill yet (void_document says "delete
--     drafts instead of voiding", and the re-price path deletes one outright).
--     It is also the harmless everyday case: seven of the eight revisions in
--     this database sit over one, and blocking on it would refuse revisions
--     nobody is double-billing.
--   • no job, on documents.job_id nor through document_jobs — because a bill a
--     job owns is already covered: convert_quote_to_job either retires it or
--     refuses to re-price it, and the board shows it either way. A job-less one
--     is the orphan: no screen carries it, no path retires it.
--
-- Tenant comes off the document itself, not the session, so the guard holds on
-- every path — including a trigger firing under a connection where
-- app.current_tenant_id() is null and a session-scoped filter would quietly
-- match nothing at all, disabling the guard exactly where it is least watched.
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
   order by i.created_at
$fn$;

comment on function app.superseded_bills(uuid) is
  'Live, job-less invoices raised from this document''s revision line — the bills left standing, counted as revenue and owed by nobody.';


-- ─── one refusal, one wording, both doors ───────────────────────────────────
-- Every caller says the same thing and names both ways out: the counter's
-- everyday case (they picked up something else — that goes on the BILL, which is
-- exactly what the tablet's "+ Add to bill" is for) and the real re-price (void
-- it, or credit it once money has changed hands). The owner/manager floor on
-- void_document is pre-existing policy and is not restated here; a cashier who
-- reaches this is meant to fetch someone, because a counter sale is being unwound.
create or replace function app.assert_no_superseded_bill(p_document_id uuid, p_subject text)
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_b   public.documents;
  v_fix text;
begin
  select * into v_b from app.superseded_bills(p_document_id) limit 1;
  if not found then return; end if;

  v_fix := case when v_b.amount_paid > 0
                then 'raise a credit note against it'
                else 'void it' end;

  raise exception
    '% has already been billed: % for Rs % is still standing and belongs to no job, so nothing would ever retire it. Anything else they are taking goes on that bill; to change the price that was agreed, % first.',
    p_subject,
    coalesce(v_b.number, 'an invoice'),
    trim(to_char(v_b.total_incl, 'FM999G999G990D00')),
    v_fix;
end $fn$;


-- ─── 1. Revising. The live body, plus one line ──────────────────────────────
CREATE OR REPLACE FUNCTION public.revise_quote(p_quote_id uuid)
 RETURNS documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_q   public.documents;
  v_new uuid := gen_random_uuid();
  v_rev public.documents;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents where id = p_quote_id and tenant_id = v_tenant;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'only quotes can be revised'; end if;

  -- Revising the same quote twice forks two rival revisions of one price, and nothing
  -- downstream can say which the customer meant. Revise the latest one instead.
  if exists (
    select 1 from public.documents c
     where c.tenant_id = v_tenant and c.source_document_id = v_q.id
       and c.doc_type = 'quote' and c.status <> 'void'
  ) then
    raise exception 'this quote has already been revised — open the latest revision instead of starting a second one';
  end if;

  -- A quote already billed on a bill no job owns is past negotiating. Refused HERE,
  -- before anyone retypes a price, rather than at the accept — and in the RPC rather
  -- than in one client's markup, so the tablet meets the same rule the web does.
  perform app.assert_no_superseded_bill(v_q.id, 'This quotation');

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, discount_kind, discount_value, created_by)
  values
    (v_new, v_tenant, 'quote', 'draft', v_q.customer_id, v_q.vehicle_id, v_q.job_id, v_q.id,
     v_q.template_id, v_q.template_overrides, v_q.currency, v_q.origin, v_q.discount_kind, v_q.discount_value, app.current_app_user_id())
  returning * into v_rev;

  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind, price_includes_vat)
  select v_tenant, v_new, product_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind, price_includes_vat
  from public.document_lines where document_id = v_q.id;

  select * into v_rev from public.documents where id = v_new;
  return v_rev;
end $function$;


-- ─── 2. Raising the second bill. The live body, plus one line ───────────────
CREATE OR REPLACE FUNCTION public.convert_quote_to_invoice(p_quote_id uuid)
 RETURNS documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_q   public.documents;
  v_inv public.documents;
  v_new uuid := gen_random_uuid();
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;

  -- Whatever quote the caller named, bill the one that stands for this job: the price
  -- signed last, or — if none was ever signed — the price the customer was last quoted.
  -- Accepting a quote issues it, so quote numbers run in the order they were agreed.
  if v_q.job_id is not null then
    select * into v_inv from public.documents
     where tenant_id = v_tenant and job_id = v_q.job_id
       and doc_type = 'quote' and status in ('accepted','issued')
     order by (status = 'accepted') desc, number desc nulls last, created_at desc
     limit 1;
    if found and v_inv.id <> v_q.id then
      select * into v_q from public.documents where id = v_inv.id for update;
    end if;
  end if;

  -- S3: a declined / expired / void quote is not billable.
  if v_q.status not in ('draft','issued','accepted') then
    raise exception 'cannot invoice a % quote', v_q.status;
  end if;

  -- Idempotent, and S1: return an existing live invoice whether it was raised
  -- from THIS quote (source_document_id) or from the quote's JOB (job_id).
  select * into v_inv from public.documents
   where doc_type = 'invoice' and tenant_id = v_tenant and status <> 'void'
     and ( source_document_id = v_q.id
           or (v_q.job_id is not null and job_id = v_q.job_id) )
   order by created_at
   limit 1;
  if found then return v_inv; end if;

  -- Below the idempotency branch on purpose. A bill raised from THIS quote is this
  -- quote's own and has just been handed back; what is left can only be a bill raised
  -- from a quote this one SUPERSEDES, and minting a second number over it would charge
  -- the same goods twice. Handing the old one back instead would be worse still — it
  -- carries the price the customer rejected.
  perform app.assert_no_superseded_bill(v_q.id, 'The quotation behind this bill');

  -- Billing a quote nobody ever sent: the counter IS the negotiation, so raising the
  -- bill issues and accepts it in one move. Below the idempotency branch, so a replay
  -- hands back the invoice without minting a second number. See the header for what a
  -- draft left behind here costs: a row the app can neither open, archive nor delete.
  if v_q.status = 'draft' then
    update public.documents set
      number     = app.next_document_number(v_tenant, 'quote'),
      status     = 'accepted',
      -- the MAURITIUS calendar day, as issue_document stamps it (UTC evenings
      -- otherwise file the day before)
      issue_date = coalesce(issue_date, ((now() at time zone 'utc') + interval '4 hours')::date),
      issued_at  = coalesce(issued_at, now())
     where id = v_q.id
    returning * into v_q;
  end if;

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
     template_id, template_overrides, currency, origin, discount_kind, discount_value, created_by)
  values
    (v_new, v_tenant, 'invoice', 'draft', v_q.customer_id, v_q.vehicle_id, v_q.job_id, v_q.id,
     v_q.template_id, v_q.template_overrides, v_q.currency, v_q.origin, v_q.discount_kind, v_q.discount_value, app.current_app_user_id())
  returning * into v_inv;

  insert into public.document_lines
    (tenant_id, document_id, product_id, vehicle_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, price_includes_vat)
  select v_tenant, v_new, product_id, vehicle_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, price_includes_vat
  from public.document_lines where document_id = v_q.id;

  -- One bill, every car's job. Without this, cars two and three read as never
  -- invoiced on the board — documents.job_id can only name one of them.
  insert into public.document_jobs (tenant_id, document_id, job_id)
  select v_tenant, v_new, j.id
    from public.jobs j
   where j.tenant_id = v_tenant
     and (j.source_quote_id = v_q.id or (v_q.job_id is not null and j.id = v_q.job_id))
  on conflict do nothing;

  update public.documents set status = 'accepted' where id = v_q.id and status = 'issued';
  select * into v_inv from public.documents where id = v_new;
  return v_inv;
end $function$;


-- ─── 3. Issuing it. The last gate, where the stock actually moves ───────────
-- The two guards above stop a second bill being RAISED. Neither does anything
-- about one already drafted — and there is one: the Rs 1,650 draft on job
-- 7e86502e, whose issue would take the same two wipers off the shelf again. So
-- the last word sits on the transition itself, beside the fiscal lock, where
-- every path reaches it — the web, the tablet, an offline replay, the cron.
--
-- It clears itself: void or credit the standing bill and the draft issues.
create or replace function app.refuse_double_bill()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  -- Cheap gate first — this runs on every update of every document. Only an
  -- invoice leaving draft, raised from a quotation, can double a bill.
  if new.doc_type = 'invoice'
     and new.status = 'issued' and old.status = 'draft'
     and new.source_document_id is not null then
    perform app.assert_no_superseded_bill(new.id, 'The quotation behind this bill');
  end if;
  return new;
end $fn$;

drop trigger if exists trg_documents_no_double_bill on public.documents;
create trigger trg_documents_no_double_bill
  before update on public.documents
  for each row execute function app.refuse_double_bill();


-- ─── 4. What the screens read ───────────────────────────────────────────────
-- Refusing is not enough on its own: INV-0204 exists, and the staff looking at
-- A00180 or at job 7e86502e can see no trace of it. One RPC, read by both
-- clients, so the warning says the same thing on the tablet and on the web.
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
$fn$;

-- Revoking from "public" leaves the anon grant standing — it is a separate entry
-- in the ACL — and a reader with no session must never enumerate a tenant's
-- outstanding bills. Named explicitly, and asserted below.
revoke execute on function public.superseded_bills(uuid) from public;
revoke execute on function public.superseded_bills(uuid) from anon;
grant  execute on function public.superseded_bills(uuid) to authenticated;


-- ─── prove it, against what is actually installed ───────────────────────────
do $$
declare
  v_def  text;
  v_acl  text;
  v_open int;
begin
  select pg_get_functiondef('public.revise_quote(uuid)'::regprocedure) into v_def;
  if position('assert_no_superseded_bill' in v_def) = 0 then
    raise exception 'revise_quote still lets a billed quote be revised';
  end if;

  select pg_get_functiondef('public.convert_quote_to_invoice(uuid)'::regprocedure) into v_def;
  if position('assert_no_superseded_bill' in v_def) = 0 then
    raise exception 'convert_quote_to_invoice still raises a second bill over a superseded one';
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'documents' and t.tgname = 'trg_documents_no_double_bill'
  ) then
    raise exception 'the draft bill already on the board can still be issued over a standing one';
  end if;

  -- The revision line must walk further than one link: that single hop IS the
  -- bug. Asserted on structure, so it holds without depending on any tenant's rows.
  select pg_get_functiondef('app.revision_chain(uuid)'::regprocedure) into v_def;
  if position('recursive' in lower(v_def)) = 0 then
    raise exception 'app.revision_chain only looks one hop back — the same blind spot as before';
  end if;

  select coalesce(proacl::text, '') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'superseded_bills';
  if v_acl like '%anon=X%' then
    raise exception 'public.superseded_bills is still executable by anon';
  end if;

  -- Say plainly what is already out there. NOT fixed here: clearing a live fiscal
  -- document is the owner's decision, one bill at a time.
  select count(*) into v_open
    from public.documents i
   where i.doc_type = 'invoice'
     and i.status not in ('draft','void')
     and i.job_id is null
     and not exists (select 1 from public.document_jobs dj where dj.document_id = i.id)
     and exists (
       select 1 from public.documents r
        where r.doc_type = 'quote' and r.status <> 'void'
          and r.source_document_id = i.source_document_id
     );
  if v_open > 0 then
    raise notice '% bill(s) already stand behind a revision and are left untouched — void or credit each one by hand', v_open;
  end if;

  raise notice 'a quote with a live job-less bill can no longer be revised, re-billed, or double-issued';
end $$;
