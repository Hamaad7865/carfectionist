-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a revised quote REPLACES the one it came from
--
-- Revising copied the quote into a fresh document and left the original sitting
-- in Sales & Invoices as "Accepted". Two live-looking quotes for one car, and
-- the counter had no way to tell which price stood: etienne gerare's A00179 and
-- A00180 (Rs 1,320 then Rs 1,650, two minutes apart) is the case that surfaced
-- it, and the live data holds sixteen more.
--
-- The original is now stamped as the parent of its revision, so the working
-- list can retire it the moment the revision goes out.
--
-- WHY A NEW COLUMN, and not source_document_id: duplicate_document writes that
-- same column for a plain COPY. Retiring the original every time somebody
-- copies a quote would hide live business. revision_of means one thing only —
-- "this document supersedes that one" — and only revise_quote writes it.
--
-- Additive. No status changes, nothing deleted: the superseded quote keeps its
-- number, its lines and its signature, and moves to the Archive tab where the
-- shop can still open it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. A revision knows what it replaces ────────────────────────────────────
alter table public.documents
  add column if not exists revision_of uuid references public.documents(id);
create index if not exists idx_documents_revision_of
  on public.documents(revision_of) where revision_of is not null;
comment on column public.documents.revision_of is
  'The quote this one supersedes. Written ONLY by revise_quote. A plain copy '
  'links back through source_document_id and supersedes nothing — which is why '
  'this cannot be derived from that column.';

-- ─── 2. The history tidies itself ────────────────────────────────────────────
-- Every quote→quote link in the live data was read row by row before this ran:
-- all eighteen are the same customer and the same car, minutes to hours apart.
-- They are revisions, so they are stamped as such, and the sixteen whose parent
-- is still visible drop out of the working list on deploy.
update public.documents c
   set revision_of = c.source_document_id
  from public.documents p
 where p.id = c.source_document_id
   and c.doc_type = 'quote'
   and p.doc_type = 'quote'
   and c.revision_of is null;

-- ─── 3. revise_quote stamps it ───────────────────────────────────────────────
-- Same signature as the live function, so this REPLACES it rather than leaving a
-- stale overload behind. Three changes:
--   • revision_of is written alongside source_document_id;
--   • the "already revised" guard reads revision_of, so a COPY of a quote no
--     longer blocks revising the original, while a revision still blocks a
--     second rival revision;
--   • the copied lines keep their vehicle_id. Without it, revising a quote that
--     covers three cars dropped every line's car and the bill could no longer
--     group by car — a hole opened when document_lines.vehicle_id arrived on
--     05/09 and this function was not updated with it.
create or replace function public.revise_quote(p_quote_id uuid)
returns public.documents
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
     where c.tenant_id = v_tenant and c.revision_of = v_q.id
       and c.doc_type = 'quote' and c.status <> 'void'
  ) then
    raise exception 'this quote has already been revised — open the latest revision instead of starting a second one';
  end if;

  insert into public.documents
    (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id, revision_of,
     template_id, template_overrides, currency, origin, discount_kind, discount_value, created_by)
  values
    (v_new, v_tenant, 'quote', 'draft', v_q.customer_id, v_q.vehicle_id, v_q.job_id, v_q.id, v_q.id,
     v_q.template_id, v_q.template_overrides, v_q.currency, v_q.origin, v_q.discount_kind, v_q.discount_value, app.current_app_user_id())
  returning * into v_rev;

  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind, price_includes_vat, vehicle_id)
  select v_tenant, v_new, product_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind, price_includes_vat, vehicle_id
  from public.document_lines where document_id = v_q.id;

  select * into v_rev from public.documents where id = v_new;
  return v_rev;
end $function$;

notify pgrst, 'reload schema';
