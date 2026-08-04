-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — billing a quote ACCEPTS it, even one still in draft.
--
-- The tablet's "Bill now — create invoice" (QuoteViewModel.convertToInvoice)
-- saves the walk-in quote as a draft and bills it in the same breath. The bill
-- was raised, issued and paid; the quote behind it stayed at 'draft' for ever,
-- because convert_quote_to_invoice only ever flipped an ISSUED quote to
-- 'accepted'. What that leaves behind:
--   • a live-looking draft in Sales & Invoices for business that is finished;
--   • /sales/<id> sends a draft to the BUILDER, so the row never reaches the
--     detail page where "Go to invoice" and Archive live — it cannot be tidied;
--   • "Delete draft" is then the only lever, and it fails, because the paid
--     invoice points back at the quote through documents.source_document_id:
--         update or delete on table "documents" violates foreign key
--         constraint "documents_source_document_id_fkey" on table "documents"
--     and the invoice is fiscally locked, so the link cannot be cut either.
--     The draft is undeletable and untidyable by every route the app has.
--     (Owner's report, 2026-08-04: the quote sitting behind INV-0063.)
--
-- The function already said the right thing for a quote that had been sent —
-- "convert_quote_to_invoice flips an 'issued' quote to 'accepted' as it bills
-- it, so the agreement is recorded at the moment it is charged". A draft agreed
-- across the counter is that same agreement: the customer heard the price and
-- paid it. So a draft is now issued and accepted as it is billed, and leaves
-- the drafts list by the front door instead of being stranded in it.
--
-- It takes a NUMBER on the way out because the schema insists — documents_check
-- is `status = 'draft' or number is not null`, so there is no such thing as a
-- numberless accepted quote. That matches how every other quote leaves draft
-- (accepting issues it, so quote numbers run in the order they were agreed).
--
-- Numbered here rather than through issue_document: that RPC is the FISCAL door
-- — a trading day, a till session, a stock movement, an idempotency key — and
-- convert_quote_to_invoice is on the money path from job billing and checkout
-- too, where none of that applies to the quote and a closed-day refusal would
-- be a new way for billing to fail. A quotation is not a fiscal document; the
-- invoice raised below carries all of it. So: the number, the acceptance, the
-- date. The letterhead snapshot is deliberately left alone — the renderer falls
-- back to live business settings (render.ts: `issued_legal_name ?? legal_name`),
-- and this quotation was never handed to anyone to preserve.
--
-- The body is otherwise the LIVE definition, unchanged — including the two
-- columns 20260804000030 added to the line copy (description_richtext,
-- unit_label). They are not incidental: this file is numbered BEFORE that one,
-- so a fresh environment replays it afterwards, and a stale column list here
-- would quietly undo the fix on every quote that gets billed. It fails silently
-- — the columns simply stop being copied, and nobody notices until an invoice
-- reaches a customer without the bullets that justified the price.
-- ═══════════════════════════════════════════════════════════════════════════

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
    (tenant_id, document_id, product_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order)
  select v_tenant, v_new, product_id, title, description, description_richtext, unit_label, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order
  from public.document_lines where document_id = v_q.id;

  update public.documents set status = 'accepted' where id = v_q.id and status = 'issued';
  select * into v_inv from public.documents where id = v_new;
  return v_inv;
end $function$;


-- ── the drafts already stranded behind a bill ───────────────────────────────
-- The same passage out, for what the old function left behind. Only where a LIVE
-- invoice stands: if the only bill raised was voided, the quote is genuinely
-- unfinished business again — it stays a draft and stays re-billable (the
-- idempotency lookup skips void invoices), and the clients now explain plainly
-- why the foreign key still refuses to delete it.
--
-- The number comes off the top of the series, not from the day the quote was
-- written: quote numbering is gapless and there is no room to insert one behind.
-- issue_date keeps the truth of when it was quoted.
update public.documents q
   set number     = app.next_document_number(q.tenant_id, 'quote'),
       status     = 'accepted',
       issue_date = coalesce(q.issue_date, (q.created_at at time zone 'UTC')::date),
       issued_at  = coalesce(q.issued_at, q.created_at)
 where q.doc_type = 'quote'
   and q.status = 'draft'
   and q.number is null
   and exists (
     select 1 from public.documents i
      where i.source_document_id = q.id
        and i.doc_type = 'invoice'
        and i.status <> 'void'
   );


-- ── prove it, against what is actually installed ────────────────────────────
do $$
declare
  v_def   text;
  v_stuck int;
begin
  select pg_get_functiondef('public.convert_quote_to_invoice(uuid)'::regprocedure) into v_def;
  if position('if v_q.status = ''draft'' then' in v_def) = 0 then
    raise exception 'convert_quote_to_invoice still leaves a billed draft quote in draft';
  end if;

  select count(*) into v_stuck
    from public.documents q
   where q.doc_type = 'quote' and q.status = 'draft'
     and exists (select 1 from public.documents i
                  where i.source_document_id = q.id and i.doc_type = 'invoice' and i.status <> 'void');
  if v_stuck > 0 then
    raise exception '% draft quote(s) still stranded behind a live invoice', v_stuck;
  end if;

  raise notice 'billing a draft quote now issues and accepts it; nothing is stranded behind a live bill';
end $$;
