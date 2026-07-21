-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — archiving documents (owner request, 2026-07-21)
--
-- A cancelled job already resolves its bill (cancel_job: draft deleted, unpaid
-- invoice voided, paid invoice credit-noted with the refund booked to a till).
-- What it can't do is TIDY: the dead paperwork stays in Sales & Invoices, so the
-- working list fills with rows nobody will act on again.
--
-- Archiving here means HIDDEN FROM THE WORKING LIST, never deleted. An issued
-- invoice is a fiscal document — MRA wants gapless numbering and a retained
-- record, which is why a void keeps its number and stamps VOID. Every archived
-- row still answers to the VAT report, the P&L, and the statements.
--
-- Two mechanisms, deliberately:
--   • DERIVED (no column): void, an invoice fully reversed by a live credit
--     note, the credit note itself, and declined/expired quotes. These are
--     archived because of what they ARE — a status change must not need a
--     backfill to be tidy, and un-archiving them by hand would be a lie.
--   • MANUAL (this column): the owner tidying anything else away.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.documents
  add column if not exists archived_at timestamptz;

comment on column public.documents.archived_at is
  'Set when a human archived this document out of the working list. Void / credited / declined / expired documents are archived by DERIVATION and do not set this. Archiving never hides a document from reports.';

-- The list asks "not archived" on every page load; keep that cheap.
create index if not exists idx_documents_archived
  on public.documents(tenant_id, archived_at)
  where archived_at is not null;

-- ── The fiscal lock must permit this one field ──────────────────────────────
-- enforce_document_lock freezes an issued invoice except for a small mutable
-- whitelist. Filing paperwork away is bookkeeping ABOUT the document, not a
-- change to it — the number, the totals and the VAT breakdown stay untouchable —
-- so archived_at joins that list. Read from the live definition and re-issued
-- with the one column added, so nothing else in the trigger can drift.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'enforce_document_lock';

  if v_def is null then raise exception 'app.enforce_document_lock not found'; end if;

  if position('''archived_at''' in v_def) = 0 then
    v_def := replace(
      v_def,
      'array[''status'',''amount_paid'',''voided_at'',''void_reason''',
      'array[''status'',''amount_paid'',''voided_at'',''void_reason'',''archived_at'''
    );
    if position('''archived_at''' in v_def) = 0 then
      raise exception 'could not extend the document lock whitelist — the array literal moved';
    end if;
    execute v_def;
  end if;
end $$;

-- ── Archiving goes through an RPC, like every other document write ──────────
-- `authenticated` holds NO update grant on documents (the fiscal lock is the
-- point), so the client cannot set this column directly — nor should it: the
-- rule "don't hide a bill that is still owed" belongs next to the data.
create or replace function public.set_document_archived(
  p_document_id uuid,
  p_archived boolean
) returns public.documents
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_doc    public.documents;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

  select * into v_doc from public.documents
   where id = p_document_id and tenant_id = v_tenant for update;
  if not found then raise exception 'document not found'; end if;

  -- An open bill is live business: hiding it would hide a debt from the list the
  -- shop chases. Collect it, void it, or credit it first.
  if p_archived
     and v_doc.doc_type = 'invoice'
     and v_doc.status in ('issued','partly_paid')
     and (v_doc.total_incl - v_doc.amount_paid) > 0.001 then
    raise exception 'this invoice is still owed — collect, void or credit it before archiving';
  end if;

  update public.documents
     set archived_at = case when p_archived then now() else null end
   where id = p_document_id
  returning * into v_doc;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor,
          case when p_archived then 'document_archived' else 'document_restored' end,
          'document', p_document_id,
          jsonb_build_object('number', v_doc.number, 'kind', v_doc.doc_type));

  return v_doc;
end $function$;

revoke all on function public.set_document_archived(uuid, boolean) from public;
grant execute on function public.set_document_archived(uuid, boolean) to authenticated;
