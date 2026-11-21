-- ═══════════════════════════════════════════════════════════════════════════
-- Issuing companies inside one tenant (the tyre centre: a VAT-registered tyre company and a
-- non-VAT service company, one site, one till, one customer list).
--
-- Plan: docs/superpowers/plans/2026-11-22-tyrecentre-two-company.md, phase B.
--
--  1. public.legal_entities — one row per issuing company, each with its own identity, VAT
--     status and gapless number series. Every existing tenant gets ONE company copied from its
--     business_settings, counters included, so its next number is exactly the one it would have
--     drawn. A one-company tenant (Carfectionist, the sandbox, the HAZ demo) sees no change.
--  2. legal_entity_id on products, documents and document_lines (all nullable). History is not
--     touched (issued invoices are locked): NULL means "the tenant's default company" wherever it
--     is read — app.entity_or_default() is the one place that rule lives.
--  3. Numbering: app.next_entity_number(tenant, company, type) replaces
--     app.next_document_number(tenant, type), which cannot know the company. Its three callers
--     (issue_document, create_and_issue_credit_note, convert_quote_to_invoice) are spliced onto
--     their LIVE bodies, and the old function now RAISES, so a missed caller fails loudly instead
--     of putting a service invoice in the tyre series. The business_settings counters are frozen.
--  4. The fiscal snapshot (issued_legal_name / issued_brn / issued_vat_number) comes from the
--     document's company.
--  5. Rules the database enforces, not just the screen:
--       · a line of a company that is not VAT-registered carries VAT 0, always;
--       · an invoice / credit note is issued only when every line belongs to its company
--         (checked at issue, so draft bills stay editable as today);
--       · a credit note belongs to the company of the invoice it credits.
--
-- Pushed outside trading hours: business_settings is locked first, so no till can draw a number
-- between copying the counters and the cut-over.
-- ═══════════════════════════════════════════════════════════════════════════

lock table public.business_settings in exclusive mode;

-- ── 1. the companies ─────────────────────────────────────────────────────────
create table if not exists public.legal_entities (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.business_settings(id) on delete cascade,
  legal_name                  text not null,
  trading_name                text,
  brn                         text,
  vat_registered              boolean not null default true,
  vat_number                  text,
  vat_rate                    numeric(5,2) not null default 15.00,
  address                     text,
  phone                       text,
  email                       text,
  bank_account_name           text,
  bank_account_number         text,
  bank_name                   text,
  receipt_logo_path           text,
  receipt_header_text         text,
  receipt_footer_text         text,
  quote_prefix                text not null,
  quote_next_number           int  not null default 1 check (quote_next_number >= 1),
  quote_number_padding        int  not null default 5 check (quote_number_padding between 1 and 12),
  invoice_prefix              text not null,
  invoice_next_number         int  not null default 1 check (invoice_next_number >= 1),
  invoice_number_padding      int  not null default 4 check (invoice_number_padding between 1 and 12),
  credit_note_prefix          text not null,
  credit_note_next_number     int  not null default 1 check (credit_note_next_number >= 1),
  credit_note_number_padding  int  not null default 4 check (credit_note_number_padding between 1 and 12),
  is_default                  boolean not null default false,
  sort_order                  int not null default 0,
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  -- A company that is not VAT-registered charges no VAT and prints no VAT number.
  constraint legal_entities_vat_consistent check (
    vat_registered or (vat_rate = 0 and nullif(btrim(coalesce(vat_number, '')), '') is null)
  ),
  constraint legal_entities_tenant_id_key unique (tenant_id, id)
);

-- Exactly one default company per tenant; prefixes never shared inside a tenant, so two series
-- can never mint the same number (documents.number is unique per tenant and type).
create unique index if not exists legal_entities_one_default on public.legal_entities (tenant_id) where is_default;
create unique index if not exists legal_entities_quote_prefix   on public.legal_entities (tenant_id, quote_prefix);
create unique index if not exists legal_entities_invoice_prefix on public.legal_entities (tenant_id, invoice_prefix);
create unique index if not exists legal_entities_cn_prefix      on public.legal_entities (tenant_id, credit_note_prefix);

drop trigger if exists trg_legal_entities_updated on public.legal_entities;
create trigger trg_legal_entities_updated before update on public.legal_entities
  for each row execute function app.set_updated_at();

alter table public.legal_entities enable row level security;
drop policy if exists legal_entities_read on public.legal_entities;
create policy legal_entities_read on public.legal_entities
  for select using (tenant_id = (select app.current_tenant_id()));
-- Read-only to the apps; companies are written by owner RPCs (phase E) and the counters only by
-- app.next_entity_number.
revoke all on public.legal_entities from anon, public;
revoke insert, update, delete on public.legal_entities from authenticated;
grant select on public.legal_entities to authenticated;

-- Backfill: one company per tenant, its identity and CURRENT counters. Every tenant charges VAT
-- today, so every backfilled company is VAT-registered (vat_number may be blank on a sandbox —
-- that must not switch its VAT off).
insert into public.legal_entities (
  tenant_id, legal_name, trading_name, brn, vat_registered, vat_number, vat_rate, address, phone, email,
  bank_account_name, bank_account_number, bank_name, receipt_logo_path, receipt_header_text, receipt_footer_text,
  quote_prefix, quote_next_number, quote_number_padding,
  invoice_prefix, invoice_next_number, invoice_number_padding,
  credit_note_prefix, credit_note_next_number, credit_note_number_padding,
  is_default, sort_order)
select bs.id, bs.legal_name, bs.trading_name, bs.brn, true, bs.vat_number, bs.vat_rate, bs.address, bs.phone, bs.email,
       bs.bank_account_name, bs.bank_account_number, bs.bank_name, bs.receipt_logo_path, bs.receipt_header_text, bs.receipt_footer_text,
       bs.quote_prefix, bs.quote_next_number, bs.quote_number_padding,
       bs.invoice_prefix, bs.invoice_next_number, bs.invoice_number_padding,
       bs.credit_note_prefix, bs.credit_note_next_number, bs.credit_note_number_padding,
       true, 0
  from public.business_settings bs
 where not exists (select 1 from public.legal_entities le where le.tenant_id = bs.id);

-- ── 2. the company of a product, a document, a line ─────────────────────────
alter table public.products       add column if not exists legal_entity_id uuid;
alter table public.documents      add column if not exists legal_entity_id uuid;
alter table public.documents      add column if not exists checkout_group_id uuid;
alter table public.document_lines add column if not exists legal_entity_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_legal_entity_fk') then
    alter table public.products add constraint products_legal_entity_fk
      foreign key (tenant_id, legal_entity_id) references public.legal_entities (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_legal_entity_fk') then
    alter table public.documents add constraint documents_legal_entity_fk
      foreign key (tenant_id, legal_entity_id) references public.legal_entities (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'document_lines_legal_entity_fk') then
    alter table public.document_lines add constraint document_lines_legal_entity_fk
      foreign key (tenant_id, legal_entity_id) references public.legal_entities (tenant_id, id);
  end if;
end $$;

create index if not exists documents_checkout_group on public.documents (tenant_id, checkout_group_id) where checkout_group_id is not null;
create index if not exists documents_legal_entity  on public.documents (tenant_id, legal_entity_id) where legal_entity_id is not null;

-- The one rule for "which company": the row's own, else the tenant's default.
create or replace function app.entity_or_default(p_tenant uuid, p_entity uuid)
returns public.legal_entities
language sql stable security definer set search_path = public, pg_temp
as $$
  select le.* from public.legal_entities le
   where le.tenant_id = p_tenant
     and (le.id = p_entity or (p_entity is null and le.is_default))
   order by (le.id = p_entity) desc nulls last
   limit 1
$$;
revoke all on function app.entity_or_default(uuid, uuid) from public, anon, authenticated;

-- A new document takes a company when it is created: its own, the credited invoice's for a credit
-- note, else the default. Never changed by this trigger afterwards (history stays NULL = default).
create or replace function app.documents_stamp_entity()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.legal_entity_id is null and new.doc_type = 'credit_note' and new.source_document_id is not null then
    select coalesce(s.legal_entity_id, (app.entity_or_default(s.tenant_id, null)).id)
      into new.legal_entity_id
      from public.documents s where s.id = new.source_document_id and s.tenant_id = new.tenant_id;
  end if;
  if new.legal_entity_id is null then
    new.legal_entity_id := (app.entity_or_default(new.tenant_id, null)).id;
  end if;
  return new;
end $$;
revoke all on function app.documents_stamp_entity() from public, anon, authenticated;
drop trigger if exists trg_documents_stamp_entity on public.documents;
create trigger trg_documents_stamp_entity before insert on public.documents
  for each row execute function app.documents_stamp_entity();

-- A line's company: its own (a custom line the cashier assigned), else its product's (a product
-- with no company is the default's), else its document's. A line of a company that is not
-- VAT-registered carries VAT 0 — on every document type, quotes included.
create or replace function app.lines_stamp_entity()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_doc_entity uuid;
  v_doc_type doc_type;
  v_ent public.legal_entities;
begin
  if tg_op = 'UPDATE'
     and new.legal_entity_id is not distinct from old.legal_entity_id
     and new.product_id is not distinct from old.product_id
     and new.vat_rate is not distinct from old.vat_rate then
    return new;
  end if;
  select d.doc_type, d.legal_entity_id into v_doc_type, v_doc_entity from public.documents d where d.id = new.document_id;
  if v_doc_type = 'credit_note' then
    -- A credit note reverses lines of ITS invoice's company, whatever the product says today.
    new.legal_entity_id := (app.entity_or_default(new.tenant_id, v_doc_entity)).id;
  elsif new.legal_entity_id is null or (tg_op = 'UPDATE' and new.product_id is distinct from old.product_id
                                        and new.legal_entity_id is not distinct from old.legal_entity_id) then
    if new.product_id is not null then
      select coalesce(p.legal_entity_id, (app.entity_or_default(new.tenant_id, null)).id) into new.legal_entity_id
        from public.products p where p.id = new.product_id and p.tenant_id = new.tenant_id;
    end if;
    if new.legal_entity_id is null then
      new.legal_entity_id := (app.entity_or_default(new.tenant_id, v_doc_entity)).id;
    end if;
  end if;
  v_ent := app.entity_or_default(new.tenant_id, new.legal_entity_id);
  if v_ent.id is not null and not v_ent.vat_registered then
    new.vat_rate := 0;
  end if;
  return new;
end $$;
revoke all on function app.lines_stamp_entity() from public, anon, authenticated;
-- Named to fire before trg_lines_lock (alphabetical): the lock still refuses any change to an
-- issued invoice's lines.
drop trigger if exists trg_lines_entity on public.document_lines;
create trigger trg_lines_entity before insert or update on public.document_lines
  for each row execute function app.lines_stamp_entity();

-- A DRAFT follows its lines: when every line belongs to one company, the draft is that company's
-- (so a draft rung up with only services numbers in the service series). Mixed lines leave it as
-- it is — a mixed invoice is refused at issue; a mixed quote stays in its own company's series.
-- Only drafts, only when the company actually changes: a one-company tenant never sees an update.
create or replace function app.draft_follows_lines()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_doc uuid := coalesce(new.document_id, old.document_id);
  v_tenant uuid;
  v_status doc_status;
  v_type doc_type;
  v_current uuid;
  v_only uuid;
  v_n int;
begin
  select d.tenant_id, d.status, d.doc_type, d.legal_entity_id into v_tenant, v_status, v_type, v_current
    from public.documents d where d.id = v_doc;
  if v_status is distinct from 'draft' or v_type = 'credit_note' then return null; end if;
  select count(distinct (app.entity_or_default(l.tenant_id, l.legal_entity_id)).id),
         min((app.entity_or_default(l.tenant_id, l.legal_entity_id)).id::text)::uuid
    into v_n, v_only
    from public.document_lines l where l.document_id = v_doc;
  if v_n = 1 and v_only is distinct from (app.entity_or_default(v_tenant, v_current)).id then
    update public.documents set legal_entity_id = v_only where id = v_doc and status = 'draft';
  end if;
  return null;
end $$;
revoke all on function app.draft_follows_lines() from public, anon, authenticated;
drop trigger if exists trg_lines_draft_follows on public.document_lines;
create trigger trg_lines_draft_follows after insert or update or delete on public.document_lines
  for each row execute function app.draft_follows_lines();

-- At issue: every line of an invoice / credit note belongs to the document's company. Read-only
-- check (it never edits the row, so the fiscal lock that follows sees nothing new).
create or replace function app.documents_entity_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_doc_entity uuid;
  v_bad int;
begin
  if new.doc_type in ('invoice','credit_note') and old.status = 'draft' and new.status <> 'draft' and new.status <> 'void' then
    v_doc_entity := (app.entity_or_default(new.tenant_id, new.legal_entity_id)).id;
    select count(*) into v_bad
      from public.document_lines l
     where l.document_id = new.id
       and (app.entity_or_default(l.tenant_id, l.legal_entity_id)).id is distinct from v_doc_entity;
    if v_bad > 0 then
      raise exception 'this % has % line(s) sold by another company — issue one per company', new.doc_type, v_bad;
    end if;
  end if;
  return new;
end $$;
revoke all on function app.documents_entity_guard() from public, anon, authenticated;
drop trigger if exists trg_documents_entity_guard on public.documents;
create trigger trg_documents_entity_guard before update on public.documents
  for each row execute function app.documents_entity_guard();

-- ── 3. numbering by company ──────────────────────────────────────────────────
create or replace function app.next_entity_number(p_tenant uuid, p_entity uuid, p_doc_type doc_type)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id uuid := (app.entity_or_default(p_tenant, p_entity)).id;
  v_prefix text; v_num int; v_pad int;
begin
  if v_id is null then
    raise exception 'tenant % has no company to number from', p_tenant;
  end if;
  if p_doc_type = 'quote' then
    update public.legal_entities set quote_next_number = quote_next_number + 1
     where id = v_id and tenant_id = p_tenant
     returning quote_prefix, quote_next_number - 1, quote_number_padding into v_prefix, v_num, v_pad;
  elsif p_doc_type = 'invoice' then
    update public.legal_entities set invoice_next_number = invoice_next_number + 1
     where id = v_id and tenant_id = p_tenant
     returning invoice_prefix, invoice_next_number - 1, invoice_number_padding into v_prefix, v_num, v_pad;
  elsif p_doc_type = 'credit_note' then
    update public.legal_entities set credit_note_next_number = credit_note_next_number + 1
     where id = v_id and tenant_id = p_tenant
     returning credit_note_prefix, credit_note_next_number - 1, credit_note_number_padding into v_prefix, v_num, v_pad;
  else
    raise exception 'no number series for doc_type %', p_doc_type;
  end if;
  if v_prefix is null then
    raise exception 'company % not found for numbering', v_id;
  end if;
  return v_prefix || lpad(v_num::text, v_pad, '0');
end $$;
revoke all on function app.next_entity_number(uuid, uuid, doc_type) from public, anon, authenticated;

-- ── splice the three callers onto their live bodies ─────────────────────────
-- Same discipline as 20261013000010: one definition, LF endings, each anchor matches exactly once,
-- a marker makes a second run a no-op.
create or replace function pg_temp.splice(p_schema text, p_name text, p_marker text, p_pairs text[])
returns void language plpgsql as $$
declare
  v_def text; v_was text; v_n int; i int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = p_schema and p.proname = p_name;
  if v_n <> 1 then raise exception '%.% has % definitions, not 1', p_schema, p_name, v_n; end if;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = p_schema and p.proname = p_name;
  if position(E'\r' in v_def) > 0 then raise exception '%.%: CRLF body', p_schema, p_name; end if;
  if position(p_marker in v_def) > 0 then return; end if;
  v_was := v_def;
  i := 1;
  while i < array_length(p_pairs, 1) loop
    v_n := (length(v_def) - length(replace(v_def, p_pairs[i], ''))) / length(p_pairs[i]);
    if v_n <> 1 then
      raise exception '%.%: anchor % matches % times, not 1 — nothing was changed: %', p_schema, p_name, (i + 1) / 2, v_n, p_pairs[i];
    end if;
    v_def := replace(v_def, p_pairs[i], p_pairs[i + 1]);
    i := i + 2;
  end loop;
  if position(p_marker in v_def) = 0 then raise exception '%.%: marker missing after splice', p_schema, p_name; end if;
  execute v_def;
end $$;

-- issue_document: number from the document's company; the fiscal snapshot from the company.
select pg_temp.splice('public', 'issue_document', 'app.next_entity_number(v_tenant, v_doc.legal_entity_id', array[
  'v_number := app.next_document_number(v_tenant, v_doc.doc_type);',
  'v_number := app.next_entity_number(v_tenant, v_doc.legal_entity_id, v_doc.doc_type);',
  'issued_legal_name  = v_bs.legal_name,',
  'issued_legal_name  = (app.entity_or_default(v_tenant, v_doc.legal_entity_id)).legal_name,',
  'issued_brn         = v_bs.brn,',
  'issued_brn         = (app.entity_or_default(v_tenant, v_doc.legal_entity_id)).brn,',
  'issued_vat_number  = v_bs.vat_number,',
  'issued_vat_number  = (select case when e.vat_registered then e.vat_number end from app.entity_or_default(v_tenant, v_doc.legal_entity_id) e),'
]);

-- Credit note: its own company (stamped on insert from the invoice it credits).
select pg_temp.splice('public', 'create_and_issue_credit_note', 'app.next_entity_number(v_tenant, (select legal_entity_id from public.documents where id = v_new)', array[
  E'v_number := app.next_document_number(v_tenant, \'credit_note\');',
  E'v_number := app.next_entity_number(v_tenant, (select legal_entity_id from public.documents where id = v_new), \'credit_note\');',
  'issued_legal_name  = v_bs.legal_name,',
  'issued_legal_name  = (select e.legal_name from public.documents d, app.entity_or_default(v_tenant, d.legal_entity_id) e where d.id = v_new),',
  'issued_brn         = v_bs.brn,',
  'issued_brn         = (select e.brn from public.documents d, app.entity_or_default(v_tenant, d.legal_entity_id) e where d.id = v_new),',
  'issued_vat_number  = v_bs.vat_number,',
  'issued_vat_number  = (select case when e.vat_registered then e.vat_number end from public.documents d, app.entity_or_default(v_tenant, d.legal_entity_id) e where d.id = v_new),'
]);

-- convert_quote_to_invoice: a quote numbered at acceptance takes its own company's quote series.
select pg_temp.splice('public', 'convert_quote_to_invoice', 'app.next_entity_number(v_tenant, v_q.legal_entity_id', array[
  E'number     = app.next_document_number(v_tenant, \'quote\'),',
  E'number     = app.next_entity_number(v_tenant, v_q.legal_entity_id, \'quote\'),'
]);

-- The old seam cannot know the company: from now on it refuses, so a caller this migration missed
-- fails loudly instead of drawing from the wrong series.
create or replace function app.next_document_number(p_tenant uuid, p_doc_type doc_type)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  raise exception 'app.next_document_number is retired — number through app.next_entity_number (the document''s company)';
end $$;
revoke all on function app.next_document_number(uuid, doc_type) from public, anon, authenticated;

-- The business_settings counters are no longer the series: freeze them so nothing drifts from
-- the companies' counters by mistake. (Scripts that reset a sandbox write legal_entities.)
create or replace function app.freeze_settings_counters()
returns trigger language plpgsql as $$
begin
  if (new.quote_next_number, new.invoice_next_number, new.credit_note_next_number,
      new.quote_prefix, new.invoice_prefix, new.credit_note_prefix,
      new.quote_number_padding, new.invoice_number_padding, new.credit_note_number_padding)
     is distinct from
     (old.quote_next_number, old.invoice_next_number, old.credit_note_next_number,
      old.quote_prefix, old.invoice_prefix, old.credit_note_prefix,
      old.quote_number_padding, old.invoice_number_padding, old.credit_note_number_padding) then
    raise exception 'number series live on the company (legal_entities), not business_settings';
  end if;
  return new;
end $$;
revoke all on function app.freeze_settings_counters() from public, anon, authenticated;
drop trigger if exists trg_business_settings_freeze_counters on public.business_settings;
create trigger trg_business_settings_freeze_counters before update on public.business_settings
  for each row execute function app.freeze_settings_counters();

-- Until the Companies settings page exists (phase E), the owner edits the business profile; keep
-- the DEFAULT company's identity in step with it so receipts and invoices show the edit, as today.
-- VAT fields only follow while the default company is VAT-registered.
create or replace function app.mirror_profile_to_default_entity()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.legal_entities le set
    legal_name          = new.legal_name,
    trading_name        = new.trading_name,
    brn                 = new.brn,
    vat_number          = case when le.vat_registered then new.vat_number else le.vat_number end,
    vat_rate            = case when le.vat_registered then new.vat_rate   else le.vat_rate   end,
    address             = new.address,
    phone               = new.phone,
    email               = new.email,
    bank_account_name   = new.bank_account_name,
    bank_account_number = new.bank_account_number,
    bank_name           = new.bank_name,
    receipt_logo_path   = new.receipt_logo_path,
    receipt_header_text = new.receipt_header_text,
    receipt_footer_text = new.receipt_footer_text
   where le.tenant_id = new.id and le.is_default
     and (new.legal_name, new.trading_name, new.brn, new.vat_number, new.vat_rate, new.address, new.phone, new.email,
          new.bank_account_name, new.bank_account_number, new.bank_name, new.receipt_logo_path,
          new.receipt_header_text, new.receipt_footer_text)
         is distinct from
         (old.legal_name, old.trading_name, old.brn, old.vat_number, old.vat_rate, old.address, old.phone, old.email,
          old.bank_account_name, old.bank_account_number, old.bank_name, old.receipt_logo_path,
          old.receipt_header_text, old.receipt_footer_text);
  return new;
end $$;
revoke all on function app.mirror_profile_to_default_entity() from public, anon, authenticated;
drop trigger if exists trg_business_settings_mirror_entity on public.business_settings;
create trigger trg_business_settings_mirror_entity after update on public.business_settings
  for each row execute function app.mirror_profile_to_default_entity();

-- A new tenant (setup-sandbox, setup-demo, create-tenant) gets its default company from the
-- settings row it inserts, counters included, so every tenant-creation path keeps working.
create or replace function app.default_entity_for_new_tenant()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.legal_entities (
    tenant_id, legal_name, trading_name, brn, vat_registered, vat_number, vat_rate, address, phone, email,
    bank_account_name, bank_account_number, bank_name, receipt_logo_path, receipt_header_text, receipt_footer_text,
    quote_prefix, quote_next_number, quote_number_padding,
    invoice_prefix, invoice_next_number, invoice_number_padding,
    credit_note_prefix, credit_note_next_number, credit_note_number_padding,
    is_default, sort_order)
  select new.id, new.legal_name, new.trading_name, new.brn, true, new.vat_number, new.vat_rate, new.address, new.phone, new.email,
         new.bank_account_name, new.bank_account_number, new.bank_name, new.receipt_logo_path, new.receipt_header_text, new.receipt_footer_text,
         new.quote_prefix, new.quote_next_number, new.quote_number_padding,
         new.invoice_prefix, new.invoice_next_number, new.invoice_number_padding,
         new.credit_note_prefix, new.credit_note_next_number, new.credit_note_number_padding,
         true, 0
   where not exists (select 1 from public.legal_entities le where le.tenant_id = new.id);
  return null;
end $$;
revoke all on function app.default_entity_for_new_tenant() from public, anon, authenticated;
drop trigger if exists trg_business_settings_default_entity on public.business_settings;
create trigger trg_business_settings_default_entity after insert on public.business_settings
  for each row execute function app.default_entity_for_new_tenant();

-- ── prove it against what is installed ──────────────────────────────────────
do $$
declare v_n int; v_callers text;
begin
  -- every tenant has exactly one default company, with the same next numbers as its settings
  select count(*) into v_n from public.business_settings bs
   where (select count(*) from public.legal_entities le where le.tenant_id = bs.id and le.is_default) <> 1;
  if v_n > 0 then raise exception '% tenant(s) without exactly one default company', v_n; end if;
  select count(*) into v_n from public.business_settings bs join public.legal_entities le on le.tenant_id = bs.id and le.is_default
   where (le.quote_prefix, le.quote_next_number, le.invoice_prefix, le.invoice_next_number, le.credit_note_prefix, le.credit_note_next_number)
         is distinct from
         (bs.quote_prefix, bs.quote_next_number, bs.invoice_prefix, bs.invoice_next_number, bs.credit_note_prefix, bs.credit_note_next_number);
  if v_n > 0 then raise exception '% company counter(s) differ from business_settings', v_n; end if;

  -- no live function still numbers through the retired seam
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_callers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','app') and p.proname <> 'next_document_number'
     and p.prosrc like '%next_document_number(%';
  if v_callers is not null then raise exception 'still numbering through the retired seam: %', v_callers; end if;

  -- one definition each, and anon cannot run the new internals
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname in ('next_entity_number','entity_or_default','documents_stamp_entity',
                                             'lines_stamp_entity','documents_entity_guard','freeze_settings_counters',
                                             'mirror_profile_to_default_entity','draft_follows_lines','default_entity_for_new_tenant');
  if v_n <> 9 then raise exception 'expected 9 new app functions, found %', v_n; end if;
  if has_function_privilege('anon', 'app.next_entity_number(uuid, uuid, doc_type)', 'execute')
     or has_function_privilege('authenticated', 'app.next_entity_number(uuid, uuid, doc_type)', 'execute') then
    raise exception 'app.next_entity_number is callable from the API';
  end if;
  if has_table_privilege('anon', 'public.legal_entities', 'select')
     or has_table_privilege('authenticated', 'public.legal_entities', 'update') then
    raise exception 'legal_entities grants are wider than read-only to signed-in users';
  end if;
end $$;
