-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a line item can say more than one sentence
--
-- The owner's real quotes read "Diamondbrite 3 YEARS PROTECTION Exterior only"
-- at MUR 30,434.78, and on its own that is a price with no justification. What
-- sells it is the four bullets underneath. Until now the shop wrote them in
-- another product because this one had nowhere to put them.
--
-- description_richtext holds a small versioned tree — paragraphs with bold /
-- italic / strike / link runs, bulleted and numbered lists, and a flat table.
-- It is jsonb rather than markup on purpose: DocumentA4 renders into a live
-- authenticated staff browser as well as into headless Chromium, so a stored
-- HTML string would be a stored-XSS payload. A typed tree that a renderer walks
-- cannot carry a script whatever is written into it.
--
-- description stays exactly as it is, written on every save as the flat-text
-- mirror of that tree. Every renderer that reads it today keeps working, and
-- any future plain-text consumer (a WhatsApp caption, a CSV cell) has something
-- to read without learning the tree.
--
-- unit_label is the free word beside the quantity — "3 panels", "4 hrs". Free
-- text rather than an enum because products.unit is a fixed set holding neither,
-- and inventing a second enum for the shop's vocabulary would be wrong twice.
--
-- Both columns are additive and nullable: every existing row keeps today's
-- behaviour, which is no unit and no rich content.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.document_lines
  add column if not exists description_richtext jsonb,
  add column if not exists unit_label           text;

comment on column public.document_lines.description_richtext is
  'Rich content for this line: {schemaVersion, blocks[]} — paragraphs with bold/italic/strike/link runs, bulleted and numbered lists, and a flat table (no merged cells, no nesting). NULL = plain description only, unchanged from before. description holds the flat-text mirror.';
comment on column public.document_lines.unit_label is
  'Free-text unit shown beside qty on the printed document, e.g. "panels", "hrs". NULL = no unit shown.';

-- Guards. A fiscal ledger row is not the place for a pasted essay, and the unit
-- is one word — anything longer is someone typing in the wrong box.
alter table public.document_lines drop constraint if exists document_lines_unit_label_len;
alter table public.document_lines add  constraint document_lines_unit_label_len
  check (unit_label is null or length(unit_label) <= 24);

alter table public.document_lines drop constraint if exists document_lines_richtext_size;
alter table public.document_lines add  constraint document_lines_richtext_size
  check (description_richtext is null or octet_length(description_richtext::text) <= 20000);

-- ── save_draft persists the two new fields ──────────────────────────────────
-- Body is the live definition (20260715000030_document_comment.sql, the newest
-- of the five that have defined this function) verbatim, plus the two new lines
-- in the document_lines insert. Signature unchanged → grants stay valid.
--
-- Note the operator. Every other line extracts with ->> (text). The rich content
-- must use -> (object): ->> on a JSON object does not fail, it returns the
-- serialised text, so the mistake would land a stringified blob in a jsonb column
-- and look perfectly fine until someone tried to query it.
create or replace function public.save_draft(p_doc jsonb, p_lines jsonb, p_expected_rev int default null)
returns public.documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_id       uuid;
  v_doc      public.documents;
  v_customer uuid := nullif(p_doc->>'customer_id','')::uuid;
  v_vehicle  uuid := nullif(p_doc->>'vehicle_id','')::uuid;
  v_template uuid := nullif(p_doc->>'template_id','')::uuid;
  v_job      uuid := nullif(p_doc->>'job_id','')::uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  if v_customer is not null and not exists (select 1 from public.customers          where id = v_customer and tenant_id = v_tenant) then
    raise exception 'unknown customer'; end if;
  if v_vehicle  is not null and not exists (select 1 from public.vehicles           where id = v_vehicle  and tenant_id = v_tenant) then
    raise exception 'unknown vehicle'; end if;
  if v_template is not null and not exists (select 1 from public.document_templates  where id = v_template and tenant_id = v_tenant) then
    raise exception 'unknown template'; end if;
  if v_job      is not null and not exists (select 1 from public.jobs               where id = v_job      and tenant_id = v_tenant) then
    raise exception 'unknown job'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) l
    where nullif(l->>'product_id','') is not null
      and not exists (select 1 from public.products pr where pr.id = (l->>'product_id')::uuid and pr.tenant_id = v_tenant)
  ) then raise exception 'unknown product on a line'; end if;

  v_id := coalesce(nullif(p_doc->>'id','')::uuid, gen_random_uuid());
  select * into v_doc from public.documents where id = v_id and tenant_id = v_tenant for update;

  if found then
    if v_doc.status <> 'draft' then raise exception 'cannot edit an issued document'; end if;
    if p_expected_rev is not null and v_doc.revision <> p_expected_rev then
      raise exception 'document was modified elsewhere (rev % expected %)', v_doc.revision, p_expected_rev;
    end if;
    update public.documents set
      doc_type           = coalesce(nullif(p_doc->>'doc_type','')::doc_type, doc_type),
      customer_id        = v_customer,
      vehicle_id         = coalesce(v_vehicle, vehicle_id),
      template_id        = coalesce(v_template, template_id),
      template_overrides = coalesce(p_doc->'template_overrides', template_overrides),
      valid_until        = coalesce(nullif(p_doc->>'valid_until','')::date, valid_until),
      due_date           = coalesce(nullif(p_doc->>'due_date','')::date, due_date),
      origin             = case when origin = 'from_job' then origin
                                else coalesce(nullif(p_doc->>'origin',''), origin) end,
      job_id             = coalesce(v_job, job_id),
      intake             = coalesce(p_doc->'intake', intake),
      discount_kind      = case when p_doc ? 'discount_kind'  then nullif(p_doc->>'discount_kind','')          else discount_kind  end,
      discount_value     = case when p_doc ? 'discount_value' then coalesce((p_doc->>'discount_value')::numeric,0) else discount_value end,
      comment            = case when p_doc ? 'comment'        then nullif(p_doc->>'comment','')                else comment        end,
      revision           = revision + 1
    where id = v_id returning * into v_doc;
  else
    insert into public.documents
      (id, tenant_id, doc_type, status, customer_id, vehicle_id, template_id,
       template_overrides, valid_until, due_date, origin, job_id, intake,
       discount_kind, discount_value, comment, created_by)
    values
      (v_id, v_tenant, coalesce(nullif(p_doc->>'doc_type','')::doc_type, 'quote'), 'draft',
       v_customer, v_vehicle, v_template, coalesce(p_doc->'template_overrides', '{}'::jsonb),
       nullif(p_doc->>'valid_until','')::date, nullif(p_doc->>'due_date','')::date,
       coalesce(nullif(p_doc->>'origin',''), 'standalone'), v_job, p_doc->'intake',
       nullif(p_doc->>'discount_kind',''), coalesce((p_doc->>'discount_value')::numeric,0),
       nullif(p_doc->>'comment',''),
       app.current_app_user_id())
    returning * into v_doc;
  end if;

  delete from public.document_lines where document_id = v_id;
  insert into public.document_lines
    (tenant_id, document_id, product_id, title, description, description_richtext, unit_label,
     qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, sort_order)
  select
    v_tenant, v_id,
    nullif(l->>'product_id','')::uuid,
    coalesce(l->>'title',''),
    nullif(l->>'description',''),
    case when jsonb_typeof(l->'description_richtext') = 'object'
         then l->'description_richtext' else null end,
    nullif(l->>'unit_label',''),
    coalesce((l->>'qty')::numeric, 1),
    coalesce((l->>'unit_price')::numeric, 0),
    coalesce((l->>'discount_pct')::numeric, 0),
    coalesce(nullif(l->>'discount_kind',''), 'percent'),
    coalesce((l->>'discount_amount')::numeric, 0),
    coalesce((l->>'vat_rate')::numeric, 15),
    coalesce((l->>'sort_order')::int, (ord - 1)::int)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(l, ord);

  perform app.recompute_doc_totals(v_id);   -- guarantee totals reflect discount + lines
  select * into v_doc from public.documents where id = v_id;
  return v_doc;
end $$;
