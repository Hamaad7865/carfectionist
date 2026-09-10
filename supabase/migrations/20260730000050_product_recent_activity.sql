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


-- Folded in from 202607300000505_stale_till_guard_hardening.sql (history repair 2026-09-10): that version stamp collided and the Supabase CLI cannot match 15-digit versions, so the two files ship as one. Applied out-of-band before this repair; already live. Do not split apart.

-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — stale-till guard, part 2: the two gaps the adversarial
-- review of 20260730000040 found.
--
-- 1. Payments. The staleness rule only covered ringing SALES (issue_document,
--    create_and_issue_credit_note). But a stale till can also take money
--    without a sale: record_payment on an old invoice, or reverse_payment —
--    both INSERT into payments with booked_session_id set, and both would file
--    that money under yesterday's Z. Their shared chokepoint is the
--    trg_payments_day_open trigger (app.guard_day_open), so the staleness
--    check goes there: every route into payments is covered at once.
--
-- 2. Replays. issue_document ran app.assert_day_open BEFORE its
--    idempotency-key replay branch. A delayed retry of an ALREADY-issued sale
--    (lost-response recovery) would now hit the staleness error even though
--    nothing new would be written — the client deserves the cached invoice
--    back, not a lecture about the till. The guard moves BELOW the replay
--    short-circuit: replays return instantly, fresh issues stay guarded.
--    Spliced from the live definition so nothing else in the function drifts.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. every payment insert that files to a till ────────────────────────────
create or replace function app.guard_day_open() returns trigger
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_closed boolean;
begin
  select d.status = 'closed' into v_closed
    from public.cash_sessions s join public.trading_days d on d.id = s.trading_day_id
   where s.id = new.booked_session_id;
  if coalesce(v_closed, false) then
    raise exception 'the day is closed — no more entries or transactions are possible';
  end if;
  -- A still-open day can be the WRONG day — same rule as ringing a sale.
  perform app.assert_till_day_current(new.booked_session_id);
  return new;
end $$;

-- ── 2. replay-before-guard in issue_document ────────────────────────────────
do $$
declare
  r       record;
  v_def text;
  v_guard constant text := E'\n  -- A closed day takes no more money — and ringing a new ticket is taking money.\n  perform app.assert_day_open(v_tenant, p_session_id);\n';
  v_anchor constant text := E'  select * into v_doc from public.documents\n   where id = p_document_id and tenant_id = v_tenant for update;';
begin
  -- Every overload that rings a ticket on a till. Later rewrites already put
  -- the guard after the replay (see 20260802000010) — those are a no-op here,
  -- as is any overload that names no session.
  for r in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'issue_document'
  loop
    select pg_get_functiondef(r.oid) into v_def;
    if v_def is null then raise exception 'public.issue_document not found'; end if;

    if position(v_guard in v_def) > 0 and position(v_anchor in v_def) > 0 then
      v_def := replace(v_def, v_guard, E'\n');                    -- out from before the replay…
      v_def := replace(v_def, v_anchor, v_guard || E'\n' || v_anchor); -- …in after it
      execute v_def;
    elsif position('assert_day_open' in v_def) = 0
      and position('p_session_id' in v_def) > 0 then
      raise exception 'issue_document (%) has no assert_day_open call at all — refusing to guess', r.oid::regprocedure;
    else
      -- Guard already sits after the replay (re-run, or a future rewrite kept
      -- it there), or this overload names no till session to guard.
      raise notice 'issue_document (%) already in the desired shape — nothing to do', r.oid::regprocedure;
    end if;
  end loop;
end $$;
