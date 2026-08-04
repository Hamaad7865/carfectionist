-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a customer saying no is not a cancelled document.
--
-- doc_status has carried 'declined' since the first migration. The flow strip
-- draws it in red, the web archive files it away, convert_quote_to_invoice
-- refuses to bill it — and nothing has ever set it. Every customer who turned a
-- quotation down was recorded as VOID instead, alongside quotes raised in error,
-- duplicates, and paperwork written off. Today's count: 26 accepted, 23 void,
-- 0 declined. Those 23 are two different stories that can no longer be told
-- apart, and the one the owner actually wants — how many quotes do we lose? —
-- is the one that was thrown away.
--
-- So: decline_quote. Same shape as void_quote, different meaning and a lower
-- bar to press it.
--
--   • Only a SENT quote can be declined. A draft was never offered (discard it);
--     an accepted one was agreed and then abandoned, which is what void_quote
--     and "Customer never came back" are for.
--   • Owner, manager OR CASHIER — recording the answer a customer gave is not
--     writing off a document. The person who sent the quote is the person who
--     hears "no", and making them fetch a manager is how it stops being
--     recorded at all.
--   • A live invoice blocks it: something has been billed, so this is a credit
--     note's job, not a decline.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.documents
  add column if not exists declined_at     timestamptz,
  add column if not exists declined_reason text;

comment on column public.documents.declined_reason is
  'Why the customer turned the quotation down, in their words. Free text, optional — a lost sale is worth counting even when nobody asked why.';

create or replace function public.decline_quote(p_quote_id uuid, p_reason text default null)
returns public.documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_q      public.documents;
  v_inv    text;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents
   where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'that document is not a quote'; end if;
  if v_q.status = 'declined' then return v_q; end if;   -- idempotent: a second tap is not an error

  if v_q.status = 'draft' then
    raise exception 'this quotation was never sent — discard it instead of declining it';
  end if;
  if v_q.status <> 'issued' then
    raise exception 'this quotation is % — only one that has been sent and not yet agreed can be declined', v_q.status;
  end if;

  select d.number into v_inv from public.documents d
   where d.source_document_id = v_q.id and d.doc_type = 'invoice' and d.status <> 'void'
   limit 1;
  if v_inv is not null then
    raise exception 'this quotation has already been billed on % — credit that invoice instead', v_inv;
  end if;

  update public.documents set
    status          = 'declined',
    declined_at     = now(),
    declined_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = v_q.id returning * into v_q;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'quote_declined', 'document', v_q.id,
          jsonb_build_object('number', v_q.number, 'reason', v_q.declined_reason));

  return v_q;
end $$;

revoke execute on function public.decline_quote(uuid, text) from public;
grant  execute on function public.decline_quote(uuid, text) to authenticated;

-- ── prove it against what is installed ──────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'decline_quote'
  ) then raise exception 'decline_quote did not install'; end if;
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'documents' and column_name = 'declined_at'
  ) then raise exception 'documents.declined_at did not install'; end if;
end $$;
