-- Two-company checkout (tyre centre): one cart → one invoice per issuing company, one payment
-- spread across them, jobs and quotes that span both companies.
--
-- A one-company tenant (Carfectionist, the HAZ demo) sees no change: every new function hands a
-- one-company document straight to the code it uses today, the narrowed indexes still cover every
-- invoice it has (none has a checkout group), and the two spliced functions behave identically
-- when checkout_group_id is NULL.
--
-- What is here:
--   1. app.split_by_company + public.split_document_by_company — a draft whose lines span
--      companies becomes one draft per company, linked by checkout_group_id (= the draft's id).
--      The first company (legal_entities.sort_order) keeps the draft's id; every other company's
--      draft gets md5(draft || ':' || company)::uuid, so a till can name it in advance
--      (public.checkout_document_ids) — e.g. for an owner's discount approval.
--   2. public.issue_checkout — split, apply each company's own bill discount, issue every draft
--      through issue_document. Replays on its key; a one-company cart IS issue_document.
--   3. public.payment_groups + public.record_checkout_payment / reverse_checkout_payment — one
--      payment across a customer's open invoices, allocated tyres-first / services-first /
--      proportionally, change on one part only.
--   4. One invoice per job / per quote now means one per job per COMPANY inside a checkout.
--   5. record_payment: a car is handed back only when every company's bill is settled.
--      cancel_job: every bill of the job is resolved, not just the first one found.
--      documents_entity_guard: a quote spanning companies cannot carry a bill discount.

-- ── 4. one invoice per job / per quote, per company inside a checkout ────────────────────────
-- Today's guarantee is kept for every document without a checkout group (all existing ones):
-- those indexes now ignore only a checkout's secondary drafts, and a second pair of indexes
-- allows at most one invoice per company inside a checkout. New indexes first, then the old go.
create unique index idx_invoice_one_per_quote_v2 on public.documents (source_document_id)
  where doc_type = 'invoice' and source_document_id is not null and status <> 'void'
    and (checkout_group_id is null or checkout_group_id = id);
create unique index idx_invoice_one_per_job_v2 on public.documents (tenant_id, job_id)
  where doc_type = 'invoice' and job_id is not null and status <> 'void'
    and (checkout_group_id is null or checkout_group_id = id);
create unique index idx_checkout_invoice_per_company_quote on public.documents (source_document_id, legal_entity_id)
  where doc_type = 'invoice' and source_document_id is not null and status <> 'void' and checkout_group_id is not null;
create unique index idx_checkout_invoice_per_company_job on public.documents (tenant_id, job_id, legal_entity_id)
  where doc_type = 'invoice' and job_id is not null and status <> 'void' and checkout_group_id is not null;
drop index public.idx_invoice_one_per_quote;
drop index public.idx_invoice_one_per_job;
alter index public.idx_invoice_one_per_quote_v2 rename to idx_invoice_one_per_quote;
alter index public.idx_invoice_one_per_job_v2 rename to idx_invoice_one_per_job;

-- ── 1. split a draft by company ───────────────────────────────────────────────────────────────
create or replace function app.split_by_company(p_tenant uuid, p_doc uuid)
returns uuid[]
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_doc  public.documents;
  v_ents uuid[];
  v_ids  uuid[];
  v_new  uuid;
  i      int;
begin
  select * into v_doc from public.documents where id = p_doc and tenant_id = p_tenant for update;
  if not found then raise exception 'document not found'; end if;
  if v_doc.status <> 'draft' then
    raise exception 'only a draft can be split by company (this one is %)', v_doc.status;
  end if;
  if v_doc.doc_type not in ('quote', 'invoice') then
    raise exception 'only a quote or an invoice can be split by company';
  end if;

  -- The companies on its lines, in the order they number.
  select array_agg(x.id order by x.sort_order, x.id) into v_ents
    from (select distinct e.id, e.sort_order
            from public.document_lines l
           cross join lateral app.entity_or_default(l.tenant_id, l.legal_entity_id) e
           where l.document_id = p_doc) x;
  if coalesce(array_length(v_ents, 1), 0) < 2 then
    return array[p_doc];   -- one company (or no lines): nothing to split, nothing touched
  end if;

  -- Owner decision 2026-11-22: discounts are per company only. The draft has ONE bill-discount
  -- field, so a figure there cannot say which company gives it.
  if v_doc.discount_kind is not null and coalesce(v_doc.discount_value, 0) > 0 then
    raise exception 'a bill discount cannot cover two companies — give each company''s bill its own discount';
  end if;

  v_ids := array[p_doc];
  update public.documents set legal_entity_id = v_ents[1], checkout_group_id = p_doc where id = p_doc;

  for i in 2 .. array_length(v_ents, 1) loop
    v_new := md5(p_doc::text || ':' || v_ents[i]::text)::uuid;
    insert into public.documents
      (id, tenant_id, doc_type, status, customer_id, vehicle_id, job_id, source_document_id,
       template_id, template_overrides, currency, origin, intake, valid_until, due_date, comment,
       created_by, cash_session_id, business_day, legal_entity_id, checkout_group_id)
    values
      (v_new, p_tenant, v_doc.doc_type, 'draft', v_doc.customer_id, v_doc.vehicle_id, v_doc.job_id, v_doc.source_document_id,
       v_doc.template_id, v_doc.template_overrides, v_doc.currency, v_doc.origin, v_doc.intake, v_doc.valid_until, v_doc.due_date, v_doc.comment,
       v_doc.created_by, v_doc.cash_session_id, v_doc.business_day, v_ents[i], p_doc)
    on conflict (id) do nothing;
    -- Split before (the draft was edited after a "two quotes" split): its company's draft is reused
    -- only while it is still a draft of this group.
    if not exists (select 1 from public.documents
                    where id = v_new and tenant_id = p_tenant and status = 'draft' and checkout_group_id = p_doc
                      and legal_entity_id = v_ents[i]) then
      raise exception 'this sale was split before and the other company''s bill has moved on — start a new sale';
    end if;

    update public.document_lines l set document_id = v_new
     where l.document_id = p_doc
       and (app.entity_or_default(l.tenant_id, l.legal_entity_id)).id = v_ents[i];
    -- Every car of the visit stays findable from every company's bill (app.invoice_jobs).
    insert into public.document_jobs (tenant_id, document_id, job_id)
    select dj.tenant_id, v_new, dj.job_id from public.document_jobs dj where dj.document_id = p_doc
    on conflict do nothing;
    perform app.recompute_doc_totals(v_new);
    v_ids := v_ids || v_new;
  end loop;
  perform app.recompute_doc_totals(p_doc);

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (p_tenant, app.current_app_user_id(), 'split_by_company', 'document', p_doc,
          jsonb_build_object('documents', to_jsonb(v_ids), 'companies', to_jsonb(v_ents)));
  return v_ids;
end $$;
revoke all on function app.split_by_company(uuid, uuid) from public, anon, authenticated;

-- What a split WOULD produce for this draft, without changing anything: one row per company on
-- its lines, with the id its draft has (or will have). Only the caller's own tenant's lines.
create or replace function public.checkout_document_ids(p_document_id uuid)
returns table (legal_entity_id uuid, document_id uuid)
language sql stable security definer set search_path = public, pg_temp
as $$
  select x.id,
         case when x.rn = 1 then p_document_id else md5(p_document_id::text || ':' || x.id::text)::uuid end
    from (select y.id, row_number() over (order by y.sort_order, y.id) rn
            from (select distinct e.id, e.sort_order
                    from public.document_lines l
                   cross join lateral app.entity_or_default(l.tenant_id, l.legal_entity_id) e
                   where l.document_id = p_document_id
                     and l.tenant_id = app.current_tenant_id()) y) x
   order by x.rn
$$;
revoke all on function public.checkout_document_ids(uuid) from public, anon;
grant execute on function public.checkout_document_ids(uuid) to authenticated;

-- "Two quotes": the builder's draft becomes one draft per company, nothing issued.
create or replace function public.split_document_by_company(p_document_id uuid)
returns setof public.documents
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_ids uuid[];
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');
  v_ids := app.split_by_company(v_tenant, p_document_id);
  return query
    select d.* from unnest(v_ids) with ordinality u(id, ord)
      join public.documents d on d.id = u.id order by u.ord;
end $$;
revoke all on function public.split_document_by_company(uuid) from public, anon;
grant execute on function public.split_document_by_company(uuid) to authenticated;

-- ── 2. issue a checkout ───────────────────────────────────────────────────────────────────────
-- p_discounts: [{legal_entity_id, discount_kind ('percent'|'amount'), discount_value, discount_reason}]
-- — each company's bill discount (amount in VAT-inclusive rupees, as save_draft takes it). The
-- allowance rules and owner approvals apply per bill, inside issue_document.
create or replace function public.issue_checkout(
  p_document_id uuid,
  p_stock_location_id uuid default null,
  p_idempotency_key text default null,
  p_session_id uuid default null,
  p_discounts jsonb default null)
returns setof public.documents
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_ids    uuid[];
  v_id     uuid;
  v_rpc    text;
  v_result jsonb;
  v_d      jsonb;
  v_target uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  -- Replay first, before anything that could refuse (same order as issue_document): a retry of a
  -- sale that already went through returns it, whatever the till or the day has done since.
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || p_idempotency_key)::bigint);
    select k.rpc, k.result into v_rpc, v_result
      from public.idempotency_keys k where k.tenant_id = v_tenant and k.key = p_idempotency_key;
    if v_result is not null then
      if v_rpc = 'issue_checkout' then
        if (v_result->>'group_id')::uuid is distinct from p_document_id then
          raise exception 'idempotency key was already used for a different document';
        end if;
        return query
          select d.* from jsonb_array_elements_text(v_result->'document_ids') with ordinality u(id, ord)
            join public.documents d on d.id = u.id::uuid order by u.ord;
        return;
      end if;
      -- A one-company sale issued under this key (by issue_document — an older till — or by the
      -- branch below): issue_document replays it and checks the key names this document.
      return query select * from public.issue_document(p_document_id, p_stock_location_id, p_idempotency_key, p_session_id);
      return;
    end if;
  end if;

  v_ids := app.split_by_company(v_tenant, p_document_id);

  for v_d in select * from jsonb_array_elements(coalesce(p_discounts, '[]'::jsonb)) loop
    select d.id into v_target
      from public.documents d
     where d.id = any (v_ids)
       and (app.entity_or_default(d.tenant_id, d.legal_entity_id)).id = nullif(v_d->>'legal_entity_id', '')::uuid;
    if v_target is null then
      raise exception 'a discount names a company with nothing on this sale';
    end if;
    if nullif(v_d->>'discount_kind', '') is not null and nullif(v_d->>'discount_kind', '') not in ('percent', 'amount') then
      raise exception 'unknown discount kind %', v_d->>'discount_kind';
    end if;
    update public.documents
       set discount_kind   = nullif(v_d->>'discount_kind', ''),
           discount_value  = coalesce(nullif(v_d->>'discount_value', '')::numeric, 0),
           discount_reason = nullif(btrim(coalesce(v_d->>'discount_reason', '')), '')
     where id = v_target;
    perform app.recompute_doc_totals(v_target);
    v_target := null;
  end loop;

  if array_length(v_ids, 1) = 1 then
    -- One company: exactly today's sale, under the caller's key.
    return query select * from public.issue_document(v_ids[1], p_stock_location_id, p_idempotency_key, p_session_id);
    return;
  end if;

  foreach v_id in array v_ids loop
    perform public.issue_document(v_id, p_stock_location_id, null, p_session_id);
  end loop;

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (tenant_id, key, rpc, result)
    values (v_tenant, p_idempotency_key, 'issue_checkout',
            jsonb_build_object('group_id', p_document_id, 'document_ids', to_jsonb(v_ids)))
    on conflict (tenant_id, key) do nothing;
  end if;

  return query
    select d.* from unnest(v_ids) with ordinality u(id, ord)
      join public.documents d on d.id = u.id order by u.ord;
end $$;
revoke all on function public.issue_checkout(uuid, uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.issue_checkout(uuid, uuid, text, uuid, jsonb) to authenticated;

-- ── 3. one payment across a checkout's invoices ──────────────────────────────────────────────
create table public.payment_groups (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.business_settings(id),
  invoice_ids     uuid[] not null,
  payment_ids     uuid[] not null,
  method          payment_method not null,
  amount          numeric(12,2) not null check (amount > 0),
  tendered        numeric(12,2),
  change_given    numeric(12,2),
  -- 'proportional', or the id of the company whose bill was filled first
  allocation      text not null,
  cash_session_id uuid not null references public.cash_sessions(id),
  received_by     uuid references public.app_users(id),
  created_at      timestamptz not null default now()
);
create index payment_groups_tenant_created on public.payment_groups (tenant_id, created_at);
alter table public.payment_groups enable row level security;
create policy payment_groups_read on public.payment_groups for select to authenticated
  using (tenant_id = app.current_tenant_id());
revoke all on public.payment_groups from anon, public;
revoke insert, update, delete, truncate on public.payment_groups from authenticated;
grant select on public.payment_groups to authenticated;
create trigger trg_payment_groups_append_only before update or delete on public.payment_groups
  for each row execute function app.forbid_mutation();

-- p_allocation: 'proportional' (each bill gets its share of what is still owed, to the cent, the
-- remainder to the bill owing most) or a company id (that company's bill is filled first, then the
-- others in company order). Paying everything owed needs no choice — each bill gets what it owes.
create or replace function public.record_checkout_payment(
  p_invoice_ids uuid[],
  p_method payment_method,
  p_amount numeric,
  p_tendered numeric default null,
  p_external_ref text default null,
  p_cash_session_id uuid default null,
  p_allocation text default 'proportional',
  p_idempotency_key text default null)
returns public.payment_groups
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_actor    uuid := app.current_app_user_id();
  v_group    public.payment_groups;
  v_existing uuid;
  v_ids      uuid[];
  v_order    uuid[];
  v_out      numeric[];
  v_ent      uuid[];
  v_alloc    numeric[];
  v_n        int;
  v_cust     int;
  v_total    numeric;
  v_left     numeric;
  v_big      int := 1;
  v_sum      numeric := 0;
  v_first    uuid;
  v_change   numeric;
  v_tender   numeric;
  v_put      boolean := false;
  v_pay      public.payments;
  v_pays     uuid[] := '{}';
  i          int;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select array_agg(distinct x) into v_ids from unnest(p_invoice_ids) x where x is not null;
  if coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'name at least one invoice to pay'; end if;

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || p_idempotency_key)::bigint);
    select (result->>'payment_group_id')::uuid into v_existing
      from public.idempotency_keys where tenant_id = v_tenant and key = p_idempotency_key;
    if v_existing is not null then
      select * into v_group from public.payment_groups where id = v_existing and tenant_id = v_tenant;
      if not (v_group.invoice_ids @> v_ids and v_ids @> v_group.invoice_ids) then
        raise exception 'idempotency key was already used for different invoices';
      end if;
      return v_group;
    end if;
  end if;

  if p_amount is null or p_amount <= 0 then raise exception 'payment amount must be positive'; end if;
  if p_method = 'points' and array_length(v_ids, 1) > 1 then
    raise exception 'points pay one bill at a time — take points on one company''s bill';
  end if;

  -- Lock in id order (two tills paying overlapping bills cannot deadlock), then read in company order.
  perform 1 from public.documents where id = any (v_ids) and tenant_id = v_tenant order by id for update;
  select count(*), count(distinct customer_id) into v_n, v_cust
    from public.documents
   where id = any (v_ids) and tenant_id = v_tenant and doc_type = 'invoice' and status in ('issued', 'partly_paid');
  if v_n <> array_length(v_ids, 1) then
    raise exception 'every bill in one payment must be an open invoice of this shop';
  end if;
  if v_cust > 1 then raise exception 'one payment can only settle one customer''s bills'; end if;

  select array_agg(d.id order by e.sort_order, e.id, d.id),
         array_agg(d.total_incl - d.amount_paid order by e.sort_order, e.id, d.id),
         array_agg(e.id order by e.sort_order, e.id, d.id),
         sum(d.total_incl - d.amount_paid)
    into v_order, v_out, v_ent, v_total
    from public.documents d
   cross join lateral app.entity_or_default(d.tenant_id, d.legal_entity_id) e
   where d.id = any (v_ids) and d.tenant_id = v_tenant;
  if p_amount > v_total + 0.001 then
    raise exception 'payment % exceeds outstanding balance %', p_amount, v_total;
  end if;

  v_n := array_length(v_order, 1);
  v_alloc := array_fill(0::numeric, array[v_n]);
  if p_amount >= v_total - 0.001 then
    v_alloc := v_out;
  elsif coalesce(p_allocation, 'proportional') = 'proportional' then
    for i in 1 .. v_n loop
      if v_out[i] > v_out[v_big] then v_big := i; end if;
    end loop;
    for i in 1 .. v_n loop
      if i <> v_big then
        v_alloc[i] := least(v_out[i], round(p_amount * v_out[i] / v_total, 2));
        v_sum := v_sum + v_alloc[i];
      end if;
    end loop;
    v_alloc[v_big] := p_amount - v_sum;
    if v_alloc[v_big] > v_out[v_big] then
      -- rounding pushed the biggest bill past what it owes: the cent goes to a bill with room
      v_left := v_alloc[v_big] - v_out[v_big];
      v_alloc[v_big] := v_out[v_big];
      for i in 1 .. v_n loop
        exit when v_left <= 0;
        if v_out[i] - v_alloc[i] > 0 then
          v_sum := least(v_left, v_out[i] - v_alloc[i]);
          v_alloc[i] := v_alloc[i] + v_sum;
          v_left := v_left - v_sum;
        end if;
      end loop;
    end if;
  elsif p_allocation ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_first := p_allocation::uuid;
    if not (v_first = any (v_ent)) then
      raise exception 'that company has no open bill in this payment';
    end if;
    v_left := p_amount;
    for i in 1 .. v_n loop
      if v_ent[i] = v_first then
        v_alloc[i] := least(v_left, v_out[i]);
        v_left := v_left - v_alloc[i];
      end if;
    end loop;
    for i in 1 .. v_n loop
      exit when v_left <= 0;
      if v_ent[i] <> v_first then
        v_alloc[i] := least(v_left, v_out[i]);
        v_left := v_left - v_alloc[i];
      end if;
    end loop;
  else
    raise exception 'unknown allocation % — use proportional or a company id', p_allocation;
  end if;

  if (select sum(a) from unnest(v_alloc) a) <> p_amount then
    raise exception 'allocation does not add up (% of %)', (select sum(a) from unnest(v_alloc) a), p_amount;
  end if;

  -- Cash is tendered once for the whole payment; the change rides on the first part, so the
  -- drawer's change total is exactly what the customer got back.
  if p_method = 'cash' then
    v_tender := coalesce(p_tendered, p_amount);
    if v_tender < p_amount then raise exception 'tendered is less than amount'; end if;
    v_change := v_tender - p_amount;
  end if;

  for i in 1 .. v_n loop
    continue when v_alloc[i] <= 0;   -- a bill whose share rounds to nothing takes no payment
    v_pay := public.record_payment(
      v_order[i], p_method, v_alloc[i],
      case when p_method = 'cash' then v_alloc[i] + case when v_put then 0 else v_change end end,
      p_external_ref, p_cash_session_id, null,
      case when p_idempotency_key is not null then p_idempotency_key || ':' || v_order[i]::text end);
    v_put := true;
    v_pays := v_pays || v_pay.id;
  end loop;

  insert into public.payment_groups
    (tenant_id, invoice_ids, payment_ids, method, amount, tendered, change_given, allocation, cash_session_id, received_by)
  values
    (v_tenant, v_ids, v_pays, p_method, p_amount, v_tender, v_change,
     coalesce(p_allocation, 'proportional'), p_cash_session_id, v_actor)
  returning * into v_group;

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (tenant_id, key, rpc, result)
    values (v_tenant, p_idempotency_key, 'record_checkout_payment', jsonb_build_object('payment_group_id', v_group.id))
    on conflict (tenant_id, key) do nothing;
  end if;
  return v_group;
end $$;
revoke all on function public.record_checkout_payment(uuid[], payment_method, numeric, numeric, text, uuid, text, text) from public, anon;
grant execute on function public.record_checkout_payment(uuid[], payment_method, numeric, numeric, text, uuid, text, text) to authenticated;

-- Reverse every part of one checkout payment, all or nothing. Each part goes through
-- reverse_payment, so its rules hold per part (owner, or an override naming that payment).
create or replace function public.reverse_checkout_payment(p_payment_group_id uuid, p_reason text default null, p_session_id uuid default null)
returns setof public.payments
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_group  public.payment_groups;
  v_id     uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');
  select * into v_group from public.payment_groups where id = p_payment_group_id and tenant_id = v_tenant;
  if not found then raise exception 'payment not found'; end if;
  foreach v_id in array v_group.payment_ids loop
    return next public.reverse_payment(v_id, p_reason, p_session_id);
  end loop;
end $$;
revoke all on function public.reverse_checkout_payment(uuid, text, uuid) from public, anon;
grant execute on function public.reverse_checkout_payment(uuid, text, uuid) to authenticated;

-- ── 5. splices onto the live bodies ──────────────────────────────────────────────────────────
create or replace function pg_temp.splice(p_schema text, p_name text, p_marker text, p_pairs text[])
returns void language plpgsql as $$
declare
  v_def text; v_n int; i int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = p_schema and p.proname = p_name;
  if v_n <> 1 then raise exception '%.% has % definitions, not 1', p_schema, p_name, v_n; end if;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = p_schema and p.proname = p_name;
  if position(chr(13) in v_def) > 0 then raise exception '%.%: CRLF body', p_schema, p_name; end if;
  if position(p_marker in v_def) > 0 then return; end if;
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

-- record_payment: settling ONE company's bill no longer hands the car back while the other
-- company's bill of the same checkout is still owed. No checkout group → exactly as before.
select pg_temp.splice('public', 'record_payment', 'two-company checkout: the car leaves', array[
  $s$  if v_paid >= v_doc.total_incl then
    for v_job_id in select ij.job_id from app.invoice_jobs(p_invoice_id) ij loop$s$,
  $s$  -- two-company checkout: the car leaves only when every company's bill is settled.
  if v_paid >= v_doc.total_incl
     and not exists (select 1 from public.documents s
                      where s.tenant_id = v_tenant and s.checkout_group_id = v_doc.checkout_group_id
                        and s.id <> v_doc.id and s.doc_type = 'invoice'
                        and s.status in ('draft', 'issued', 'partly_paid')) then
    for v_job_id in select ij.job_id from app.invoice_jobs(p_invoice_id) ij loop$s$
]);

-- cancel_job: a job billed by two companies has two bills; each is resolved (draft deleted,
-- unpaid voided, paid credit-noted). One bill → exactly as before.
select pg_temp.splice('public', 'cancel_job', 'every bill of the job, each company''s', array[
  $s$  select * into v_inv from public.documents
   where tenant_id = v_tenant and job_id = p_job_id
     and doc_type = 'invoice' and status <> 'void'
   for update;
  if found then$s$,
  $s$  -- every bill of the job, each company's (a two-company visit has two)
  for v_inv in
    select * from public.documents
     where tenant_id = v_tenant and job_id = p_job_id
       and doc_type = 'invoice' and status <> 'void'
     order by created_at, id
     for update
  loop$s$,
  $s$      v_money := 'draft deleted';$s$,
  $s$      v_money := concat_ws('; ', nullif(v_money, 'no invoice'), 'draft deleted');$s$,
  $s$      v_money := 'bill ' || coalesce(v_inv.number, '?') || ' voided';$s$,
  $s$      v_money := concat_ws('; ', nullif(v_money, 'no invoice'), 'bill ' || coalesce(v_inv.number, '?') || ' voided');$s$,
  $s$      v_money := 'bill ' || coalesce(v_inv.number, '?') || ' credit-noted, ' || v_inv.amount_paid || ' refunded';
    end if;
  end if;$s$,
  $s$      v_money := concat_ws('; ', nullif(v_money, 'no invoice'), 'bill ' || coalesce(v_inv.number, '?') || ' credit-noted, ' || v_inv.amount_paid || ' refunded');
    end if;
  end loop;$s$
]);

-- At issue: an invoice / credit note is one company's (phase B); a QUOTE may span companies
-- ("one quote for both"), but then it cannot carry a bill discount — the bills it becomes are
-- one per company and the discount could not say whose it is.
create or replace function app.documents_entity_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_doc_entity uuid;
  v_bad int;
begin
  if old.status = 'draft' and new.status <> 'draft' and new.status <> 'void' then
    if new.doc_type in ('invoice','credit_note') then
      v_doc_entity := (app.entity_or_default(new.tenant_id, new.legal_entity_id)).id;
      select count(*) into v_bad
        from public.document_lines l
       where l.document_id = new.id
         and (app.entity_or_default(l.tenant_id, l.legal_entity_id)).id is distinct from v_doc_entity;
      if v_bad > 0 then
        raise exception 'this % has % line(s) sold by another company — issue one per company', new.doc_type, v_bad;
      end if;
    elsif new.doc_type = 'quote' and new.discount_kind is not null and coalesce(new.discount_value, 0) > 0 then
      select count(distinct (app.entity_or_default(l.tenant_id, l.legal_entity_id)).id) into v_bad
        from public.document_lines l where l.document_id = new.id;
      if v_bad > 1 then
        raise exception 'a bill discount cannot cover two companies — give each company''s bill its own discount';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function app.documents_entity_guard() from public, anon, authenticated;

-- ── prove it against what is installed ──────────────────────────────────────────────────────
do $$
declare v_n int; v_f text;
begin
  -- the narrowed indexes exist under their old names and still cover every group-less invoice
  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and tablename = 'documents'
     and indexname in ('idx_invoice_one_per_quote', 'idx_invoice_one_per_job',
                       'idx_checkout_invoice_per_company_quote', 'idx_checkout_invoice_per_company_job')
     and indexdef like 'CREATE UNIQUE INDEX%';
  if v_n <> 4 then raise exception 'expected 4 unique invoice indexes, found %', v_n; end if;
  if (select count(*) from public.documents where checkout_group_id is not null) > 0 then
    raise exception 'documents already carry a checkout group — the narrowed indexes would not cover them';
  end if;

  -- the splices are in
  if not exists (select 1 from pg_proc where proname = 'record_payment' and prosrc like '%two-company checkout: the car leaves%') then
    raise exception 'record_payment splice missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'cancel_job' and prosrc like '%for v_inv in%') then
    raise exception 'cancel_job splice missing';
  end if;

  -- the API can reach the new public calls when signed in, never anonymously; never the internals
  foreach v_f in array array[
    'public.issue_checkout(uuid, uuid, text, uuid, jsonb)',
    'public.split_document_by_company(uuid)',
    'public.checkout_document_ids(uuid)',
    'public.record_checkout_payment(uuid[], payment_method, numeric, numeric, text, uuid, text, text)',
    'public.reverse_checkout_payment(uuid, text, uuid)'] loop
    if has_function_privilege('anon', v_f, 'execute') then raise exception '% is callable anonymously', v_f; end if;
    if not has_function_privilege('authenticated', v_f, 'execute') then raise exception '% is not callable when signed in', v_f; end if;
  end loop;
  if has_function_privilege('authenticated', 'app.split_by_company(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'app.split_by_company(uuid, uuid)', 'execute') then
    raise exception 'app.split_by_company is callable from the API';
  end if;
  if has_table_privilege('anon', 'public.payment_groups', 'select')
     or has_table_privilege('authenticated', 'public.payment_groups', 'insert') then
    raise exception 'payment_groups grants are wider than read-only to signed-in users';
  end if;
end $$;
