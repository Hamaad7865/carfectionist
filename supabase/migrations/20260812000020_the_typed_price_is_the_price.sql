-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — the typed price is the price. Rs 1000 stays Rs 1000.
--
-- The shop quotes VAT-INCLUSIVE prices. A price typed at the till was converted
-- to a 2dp NET (1000 / 1.15 → 869.57) and the ledger re-added VAT on the rounded
-- net (869.57 + 130.44 = 1000.01). Rs 1000 has NO exact 2dp net at 15%: the round
-- trip cannot land on it, and the owner watched a 1000 become 1000.01.
--
-- The fix: a line may now say its unit_price IS the VAT-inclusive figure, exactly
-- as typed (price_includes_vat = true). For such a line the ledger EXTRACTS the
-- VAT instead of adding it:
--
--     gross     = round(qty * unit_price, 2)            -- what was typed
--     net_gross = gross less its discount               -- amount: minus rupees off
--                                                       -- percent: round(gross*(1-p), 2)
--     excl      = round(net_gross / (1 + r), 2)
--     vat       = net_gross - excl                      -- the difference, so the
--                                                       -- sum is EXACTLY net_gross
--
-- 1000 → excl 869.57, vat 130.43, total exactly 1000.00. The slip's VAT line
-- reads the extracted figure (130.43, not 130.44) — the correct VAT for an
-- inclusive price, and what makes the total exact.
--
-- HISTORY IS UNTOUCHED. The flag defaults to false, and the false branch of both
-- generated columns is the previous expression VERBATIM — re-adding the columns
-- recomputes every stored row, and issued invoices are fiscal records, so this
-- migration snapshots every (excl, vat) pair first and REFUSES to commit if a
-- single one moved.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the flag ────────────────────────────────────────────────────────────
alter table public.document_lines
  add column if not exists price_includes_vat boolean not null default false;

comment on column public.document_lines.price_includes_vat is
  'True: unit_price is the VAT-INCLUSIVE figure exactly as typed, and the ledger extracts the VAT (total lands on the typed number). False (default, all history): unit_price is net and VAT is added on top.';

-- ── 2. snapshot every stored figure before the columns are regenerated ─────
create temp table _lines_before as
  select id, line_total_excl, line_vat from public.document_lines;

-- ── 3. regenerate the two columns with the inclusive branch ────────────────
alter table public.document_lines
  drop column if exists line_vat,
  drop column if exists line_total_excl;

alter table public.document_lines
  add column line_total_excl numeric(12,2) generated always as (
    case when price_includes_vat then
      round(
        (case when discount_kind = 'amount'
              then greatest(round(qty * unit_price, 2) - discount_amount, (0)::numeric)
              else round(round(qty * unit_price, 2) * ((1)::numeric - (discount_pct / 100.0)), 2)
         end) / ((1)::numeric + (vat_rate / 100.0)), 2)
    else
      -- the previous expression, verbatim
      round(
        case
          when (discount_kind = 'amount'::text) then greatest(((qty * unit_price) - (discount_amount / ((1)::numeric + (vat_rate / 100.0)))), (0)::numeric)
          else ((qty * unit_price) * ((1)::numeric - (discount_pct / 100.0)))
        end, 2)
    end
  ) stored;

alter table public.document_lines
  add column line_vat numeric(12,2) generated always as (
    case when price_includes_vat then
      -- net_gross minus the extracted excl: the pair sums to net_gross EXACTLY.
      (case when discount_kind = 'amount'
            then greatest(round(qty * unit_price, 2) - discount_amount, (0)::numeric)
            else round(round(qty * unit_price, 2) * ((1)::numeric - (discount_pct / 100.0)), 2)
       end)
      - round(
        (case when discount_kind = 'amount'
              then greatest(round(qty * unit_price, 2) - discount_amount, (0)::numeric)
              else round(round(qty * unit_price, 2) * ((1)::numeric - (discount_pct / 100.0)), 2)
         end) / ((1)::numeric + (vat_rate / 100.0)), 2)
    else
      -- the previous expression, verbatim
      round(((round(
        case
          when (discount_kind = 'amount'::text) then greatest(((qty * unit_price) - (discount_amount / ((1)::numeric + (vat_rate / 100.0)))), (0)::numeric)
          else ((qty * unit_price) * ((1)::numeric - (discount_pct / 100.0)))
        end, 2) * vat_rate) / 100.0), 2)
    end
  ) stored;

-- ── 4. prove not one historical figure moved ───────────────────────────────
do $$
declare v_moved int;
begin
  select count(*) into v_moved
    from _lines_before b
    join public.document_lines l on l.id = b.id
   where l.line_total_excl is distinct from b.line_total_excl
      or l.line_vat is distinct from b.line_vat;
  if v_moved > 0 then
    raise exception 'the regenerated columns moved % historical line(s) — REFUSING. Issued invoices are fiscal records.', v_moved;
  end if;
end $$;

-- ── 5. save_draft carries the flag through ─────────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_draft';
  if v_def is null then raise exception 'public.save_draft not found'; end if;
  if position('price_includes_vat' in v_def) > 0 then return; end if; -- already carries it

  if position('vat_rate, sort_order, line_kind)' in v_def) = 0 then
    raise exception 'save_draft: line-insert column anchor not found';
  end if;
  v_def := replace(v_def,
    'vat_rate, sort_order, line_kind)',
    'vat_rate, sort_order, line_kind, price_includes_vat)');

  if position('nullif(l->>''line_kind'','''')::product_kind end' in v_def) = 0 then
    raise exception 'save_draft: line-insert value anchor not found';
  end if;
  v_def := replace(v_def,
    'nullif(l->>''line_kind'','''')::product_kind end',
    'nullif(l->>''line_kind'','''')::product_kind end,
    coalesce((l->>''price_includes_vat'')::boolean, false)');

  execute v_def;
end $$;

-- ── 6. the allowance reads a flagged line's gross directly ─────────────────
-- Same body as 20260812000010, with the l CTE branching on the flag: a flagged
-- line's unit_price IS the gross, so gross_incl is just round(qty*unit, 2) and
-- the carwash floor is a straight percentage of it — no re-grossing, no drift.
create or replace function app.document_discount_limits(p_doc uuid)
returns table(ceiling_incl numeric, free_incl numeric, actual_incl numeric)
language sql stable set search_path = public, pg_temp
as $$
  with cfg as (
    select
      coalesce(bs.discount_carwash_pct, 5)        as carwash_pct,
      coalesce(bs.default_policy_service, 'none')  as def_service,
      coalesce(bs.default_policy_goods, 'free')    as def_goods
    from public.documents d
    left join public.business_settings bs on bs.id = d.tenant_id
    where d.id = p_doc
  ),
  l as (
    select
      case when dl.price_includes_vat
           then round(dl.qty * dl.unit_price, 2)
           else round(dl.qty * dl.unit_price, 2)
              + round(round(dl.qty * dl.unit_price, 2) * dl.vat_rate / 100.0, 2)
      end as gross_incl,
      case when dl.price_includes_vat
           then round(round(dl.qty * dl.unit_price, 2) * (1 - cfg.carwash_pct / 100.0), 2)
           else round(dl.qty * dl.unit_price * (1 - cfg.carwash_pct / 100.0), 2)
              + round(round(dl.qty * dl.unit_price * (1 - cfg.carwash_pct / 100.0), 2) * dl.vat_rate / 100.0, 2)
      end as net_at_max,
      dl.line_total_excl + dl.line_vat                                     as net_incl,
      coalesce(
        nullif(p.discount_policy, 'inherit'),
        case when coalesce(dl.line_kind, p.kind, 'service') = 'service'
             then cfg.def_service else cfg.def_goods end
      ) as policy
    from public.document_lines dl
    left join public.products p on p.id = dl.product_id
    cross join cfg
    where dl.document_id = p_doc
  ),
  agg as (
    select
      coalesce(sum(case policy when 'free'    then gross_incl
                               when 'carwash' then greatest(gross_incl - net_at_max, 0)
                               else 0 end), 0)                             as ceiling,
      coalesce(sum(case policy when 'free' then gross_incl else 0 end), 0)  as free_part,
      coalesce(sum(greatest(gross_incl - net_incl, 0)), 0)                  as line_disc,
      coalesce(sum(net_incl), 0)                                           as post_line_gross
    from l
  ),
  ord as (
    select case
      when d.discount_kind is null or coalesce(d.discount_value, 0) = 0 then 0
      when d.discount_kind = 'percent' then round(a.post_line_gross * d.discount_value / 100.0, 2)
      else least(d.discount_value, a.post_line_gross) end as o
    from public.documents d cross join agg a
    where d.id = p_doc
  )
  select round(a.ceiling, 2), round(a.free_part, 2), round(a.line_disc + coalesce(o.o, 0), 2)
  from agg a left join ord o on true;
$$;

-- ── 7. prove the pieces landed ─────────────────────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_draft';
  if position('price_includes_vat' in v_def) = 0 then
    raise exception 'save_draft does not carry price_includes_vat';
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'document_discount_limits';
  if position('price_includes_vat' in v_def) = 0 then
    raise exception 'document_discount_limits does not branch on price_includes_vat';
  end if;
  if position('cfg.carwash_pct' in v_def) = 0 then
    raise exception 'document_discount_limits lost the owner-editable cap';
  end if;
end $$;

drop table _lines_before;
