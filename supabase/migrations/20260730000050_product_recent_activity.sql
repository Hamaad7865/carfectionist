-- Recent activity for ONE catalogue item — the history line that opens under a
-- row on /products, so "where did the 8 go" is answerable without leaving the list.
--
-- Two sources, because a service never touches the stock ledger:
--   stocked item          → stock_movements (every in and out, whatever moved it)
--   service / non-stocked → issued invoice + credit-note lines
--
-- One function rather than three round trips from the app: stock_movements.ref_id
-- is polymorphic (no FK, it points at a document OR a job OR a PO OR a transfer),
-- so PostgREST cannot resolve the document number on its own.
--
-- security INVOKER (the plpgsql default) — the caller's RLS still decides what
-- they may see, and a row they may not read simply comes back with a null label.

create or replace function public.product_recent_activity(p_product_id uuid, p_limit int default 8)
returns table (
  event_id      uuid,
  happened_at   timestamptz,
  qty           numeric,
  -- 'movement' = a real stock in/out; 'line' = a service that was billed. The
  -- caller must not have to infer this from a null location.
  source        text,
  kind          text,
  ref_id        uuid,
  location_name text,
  doc_number    text,
  party_name    text,
  note          text,
  actor_name    text
)
language plpgsql stable
set search_path = public, pg_temp
as $$
declare v_stocked boolean;
begin
  -- RLS-scoped: a product this caller cannot see reads as null, and gets nothing.
  select p.is_stocked into v_stocked from public.products p where p.id = p_product_id;
  if v_stocked is null then return; end if;

  if v_stocked then
    return query
    select m.id,
           m.moved_at,
           m.qty,
           'movement'::text,
           m.ref_type::text,
           m.ref_id,
           l.name,
           d.number,
           -- "The other side" of the event: who bought it, who supplied it, whose
           -- job consumed it, or which shelf the transfer's other half sits on.
           case m.ref_type
             when 'transfer'       then case when m.qty < 0 then tt.name else tf.name end
             when 'purchase_order' then sup.name
             when 'job_card'       then jc.name
             else dc.name
           end,
           m.note,
           u.display_name
    from public.stock_movements m
    left join public.stock_locations l   on l.id   = m.location_id
    left join public.documents       d   on d.id   = m.ref_id and m.ref_type in ('invoice', 'credit_note')
    left join public.customers       dc  on dc.id  = d.customer_id
    left join public.jobs            j   on j.id   = m.ref_id and m.ref_type = 'job_card'
    left join public.customers       jc  on jc.id  = j.customer_id
    left join public.purchase_orders po  on po.id  = m.ref_id and m.ref_type = 'purchase_order'
    left join public.suppliers       sup on sup.id = po.supplier_id
    left join public.stock_transfers t   on t.id   = m.ref_id and m.ref_type = 'transfer'
    left join public.stock_locations tf  on tf.id  = t.from_location_id
    left join public.stock_locations tt  on tt.id  = t.to_location_id
    left join public.app_users       u   on u.id   = m.created_by
    where m.product_id = p_product_id
    order by m.moved_at desc, m.id desc
    limit greatest(p_limit, 0);
  else
    -- No ledger to read, so the history is "who was it billed to". Issued only:
    -- a draft or a quote is not something that happened.
    return query
    select dl.id,
           coalesce(d.issued_at, d.created_at),
           dl.qty,
           'line'::text,
           d.doc_type::text,
           d.id,
           null::text,
           d.number,
           c.name,
           dl.description,
           null::text
    from public.document_lines dl
    join public.documents d on d.id = dl.document_id
    left join public.customers c on c.id = d.customer_id
    where dl.product_id = p_product_id
      and d.doc_type in ('invoice', 'credit_note')
      and d.issued_at is not null
    order by coalesce(d.issued_at, d.created_at) desc, dl.id desc
    limit greatest(p_limit, 0);
  end if;
end $$;

revoke execute on function public.product_recent_activity(uuid, int) from public;
grant  execute on function public.product_recent_activity(uuid, int) to authenticated;

-- PostgREST must see the new signature (Supabase auto-reloads on DDL; insurance).
notify pgrst, 'reload schema';
