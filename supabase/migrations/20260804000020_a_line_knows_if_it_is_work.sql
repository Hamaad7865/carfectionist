-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a typed-in line says whether it is work or goods.
--
-- The shop's flow: a quote is sent, the customer signs it, and what happens next
-- depends on what is ON it. Work on a car becomes a JOB on the board. Goods over
-- the counter are a SALE — there is nothing to track through the bays.
--
-- The app cannot tell the two apart today. A catalogue line answers through
-- products.kind ('service' | 'product' | 'consumable'), but an AD-HOC line — the
-- one someone types because it is not in the catalogue — carries product_id NULL
-- and nothing else. There is no column that could hold the answer, so the accept
-- panel has always had to guess, and it guessed "start the work now" every time.
--
-- So: document_lines.line_kind. Set explicitly on a typed-in line (both surfaces
-- now ask, always); left NULL on a catalogue line, where products.kind is the
-- better answer and duplicating it would only let the two drift.
--
-- The effective kind of a line is therefore:
--     coalesce(line_kind, products.kind, 'service')
--
-- The 'service' at the end is for HISTORY only. Every ad-hoc line written before
-- today has no stated kind, and ad-hoc lines have overwhelmingly been typed
-- labour — create_intake_quote and create_document_from_job both raise theirs as
-- the literal words "Service work". Reading those as goods would put the shop's
-- back catalogue of quotes on the wrong side of the decision. From today nothing
-- new relies on it: the dialogs ask.
--
-- NOT TOUCHED: convert_quote_to_invoice and create_and_issue_credit_note. Both
-- copy lines onto an INVOICE or a credit note, where nothing reads the kind —
-- the job-or-sale question is asked of a quote, once, as it is accepted. Leaving
-- them alone also keeps this clear of the billing change landing beside it.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.document_lines
  add column if not exists line_kind product_kind;

comment on column public.document_lines.line_kind is
  'Stated kind of a typed-in (ad-hoc) line. NULL on a catalogue line — products.kind answers for those. Effective kind: coalesce(line_kind, products.kind, ''service'').';

-- ── the writer: save_draft carries what the dialogs stated ───────────────────
-- Spliced from the live definition rather than restated: this function is long,
-- it has been edited by four migrations, and retyping it is how a body silently
-- reverts (see 20260802000010).
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_draft';
  if v_def is null then raise exception 'public.save_draft not found'; end if;

  -- A CATALOGUE line's kind is not the client's to state: products.kind answers, and
  -- storing a second copy here is how the two come to disagree. The RPC drops it rather
  -- than trusting every client to remember — the trailing comment is the marker that
  -- says this guarded form is installed, and it survives pg_get_functiondef.
  if position('catalogue lines defer' in v_def) = 0 then
    if position('line_kind' in v_def) > 0 then
      -- An earlier run spliced the ungarded form; upgrade it in place.
      v_def := replace(
        v_def,
        'nullif(l->>''line_kind'','''')::product_kind',
        'case when nullif(l->>''product_id'','''') is null
          then nullif(l->>''line_kind'','''')::product_kind end /* catalogue lines defer to products.kind */'
      );
    else
      if position('discount_pct, discount_kind, discount_amount, vat_rate, sort_order)' in v_def) = 0 then
        raise exception 'save_draft: column-list anchor not found — line_kind NOT installed';
      end if;
      v_def := replace(
        v_def,
        'discount_pct, discount_kind, discount_amount, vat_rate, sort_order)',
        'discount_pct, discount_kind, discount_amount, vat_rate, sort_order, line_kind)'
      );

      if position('coalesce((l->>''sort_order'')::int, (ord - 1)::int)' in v_def) = 0 then
        raise exception 'save_draft: select-list anchor not found — line_kind NOT installed';
      end if;
      v_def := replace(
        v_def,
        'coalesce((l->>''sort_order'')::int, (ord - 1)::int)',
        'coalesce((l->>''sort_order'')::int, (ord - 1)::int),
    case when nullif(l->>''product_id'','''') is null
          then nullif(l->>''line_kind'','''')::product_kind end /* catalogue lines defer to products.kind */'
      );
    end if;
    execute v_def;
  end if;
end $$;

-- ── the copiers: a revision and a duplicate keep what was stated ─────────────
-- A revision IS the quote being renegotiated, and a duplicate is that quote
-- again. Dropping the kinds on the way through would make the accept panel
-- guess again on exactly the documents most likely to be accepted.
do $$
declare
  v_def text;
  v_fn  text;
begin
  foreach v_fn in array array['revise_quote', 'duplicate_document'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_def is null then raise exception 'public.% not found', v_fn; end if;
    continue when position('line_kind' in v_def) > 0;

    if position('vat_rate, sort_order)' in v_def) = 0
       or position('vat_rate, sort_order
  from public.document_lines' in v_def) = 0 then
      raise exception '%: line-copy anchors not found — line_kind NOT carried', v_fn;
    end if;

    -- The select first: its anchor is a prefix of nothing else, and doing the
    -- column list first would make the two indistinguishable.
    v_def := replace(
      v_def,
      'vat_rate, sort_order
  from public.document_lines',
      'vat_rate, sort_order, line_kind
  from public.document_lines'
    );
    v_def := replace(v_def, 'vat_rate, sort_order)', 'vat_rate, sort_order, line_kind)');
    execute v_def;
  end loop;
end $$;

-- ── the two placeholder lines the app writes itself ──────────────────────────
-- Both say "Service work" in so many words. Saying it in the data too is what
-- lets reception's intake quote and a job's bill default to a job without
-- anybody ticking anything.
do $$
declare
  v_def text;
  v_fn  text;
begin
  foreach v_fn in array array['create_intake_quote', 'create_document_from_job'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_def is null then raise exception 'public.% not found', v_fn; end if;
    continue when position('line_kind' in v_def) > 0;

    if position('discount_pct, vat_rate, sort_order)' in v_def) = 0
       or position('coalesce(v_bs.vat_rate, 15), 0);' in v_def) = 0 then
      raise exception '%: placeholder-line anchors not found — line_kind NOT set', v_fn;
    end if;
    v_def := replace(v_def, 'discount_pct, vat_rate, sort_order)', 'discount_pct, vat_rate, sort_order, line_kind)');
    v_def := replace(v_def, 'coalesce(v_bs.vat_rate, 15), 0);', 'coalesce(v_bs.vat_rate, 15), 0, ''service'');');
    execute v_def;
  end loop;
end $$;

-- ── prove it against what is actually installed ─────────────────────────────
do $$
declare v_missing text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('save_draft', 'revise_quote', 'duplicate_document', 'create_intake_quote', 'create_document_from_job')
     and position('line_kind' in pg_get_functiondef(p.oid)) = 0;
  if v_missing is not null then
    raise exception 'line_kind did not reach: %', v_missing;
  end if;

  if (select position('catalogue lines defer' in pg_get_functiondef(p.oid)) = 0
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'save_draft') then
    raise exception 'save_draft still trusts a catalogue line''s stated kind';
  end if;
end $$;


-- Folded in from 202608040000205_lines_carry_rich_content.sql (history repair 2026-09-10): that version stamp collided and the Supabase CLI cannot match 15-digit versions, so the two files ship as one. Applied out-of-band before this repair; already live. Do not split apart.

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
