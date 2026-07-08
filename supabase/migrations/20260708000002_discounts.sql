-- ═══════════════════════════════════════════════════════════════════════════
-- Discount module — fiscal core (line-level and order-level; % or fixed Rs).
--
-- Prices are VAT-INCLUSIVE for staff, but the ledger stores ex-VAT and adds VAT
-- on top. So a fixed "Rs X off" is INCLUSIVE and must be divided by (1+vat/100)
-- to reach the ex-VAT base the columns store.
--
--   LINE : document_lines.discount_kind + discount_amount. The generated
--          line_total_excl becomes a CASE — 'percent' keeps discount_pct,
--          'amount' subtracts discount_amount/(1+vat_rate/100).
--   ORDER: documents.discount_kind + discount_value. app.discounted_vat_groups()
--          is the SINGLE authority: it returns per-rate (base, vat) after
--          apportioning the order discount across VAT-rate groups by inclusive
--          share (largest-remainder), and collapses to the exact undiscounted
--          line sums when there is no discount — so the canonical
--          77,200 / 11,580 / 88,780 vector stays byte-identical.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. line-level discount columns + regenerated line totals ────────────────────
alter table document_lines
  add column if not exists discount_kind text not null default 'percent'
    check (discount_kind in ('percent','amount')),
  add column if not exists discount_amount numeric(12,2) not null default 0
    check (discount_amount >= 0);

-- generated columns cannot be ALTERed in place — drop and re-add with the CASE
alter table document_lines drop column if exists line_total_excl;
alter table document_lines drop column if exists line_vat;
alter table document_lines
  add column line_total_excl numeric(12,2) generated always as (
    round(case when discount_kind = 'amount'
               then greatest(qty * unit_price - discount_amount/(1 + vat_rate/100.0), 0)
               else qty * unit_price * (1 - discount_pct/100.0) end, 2)
  ) stored,
  add column line_vat numeric(12,2) generated always as (
    round( round(case when discount_kind = 'amount'
               then greatest(qty * unit_price - discount_amount/(1 + vat_rate/100.0), 0)
               else qty * unit_price * (1 - discount_pct/100.0) end, 2) * vat_rate/100.0, 2)
  ) stored;

-- 2. order-level discount columns on documents ───────────────────────────────
alter table documents
  add column if not exists discount_kind text check (discount_kind in ('percent','amount')),
  add column if not exists discount_value numeric(12,2) not null default 0 check (discount_value >= 0);

-- 3. the single VAT-groups authority (post-order-discount) ────────────────────
-- Returns one row per VAT rate with the discounted (base, vat). No order
-- discount → returns the exact summed line columns (vector-preserving).
create or replace function app.discounted_vat_groups(p_doc uuid)
returns table(rate numeric, base numeric, vat numeric) language sql stable
set search_path = public, pg_temp as $$
  with d as (select discount_kind k, discount_value v from public.documents where id = p_doc),
  grp as (
    select vat_rate rate, sum(line_total_excl) base0, sum(line_vat) vat0,
           sum(line_total_excl + line_vat) incl
    from public.document_lines where document_id = p_doc group by vat_rate
  ),
  tot as (select coalesce(sum(incl),0) gross from grp),
  disc as (
    select case when (select k from d) is null or coalesce((select v from d),0) = 0 then 0
                when (select k from d) = 'percent' then round((select gross from tot) * (select v from d)/100.0, 2)
                else least((select v from d), (select gross from tot)) end d_incl
  ),
  alloc as (
    select g.rate, g.base0, g.vat0, g.incl,
           row_number() over (order by g.incl desc, g.rate) rn,
           round((select d_incl from disc) * g.incl / nullif((select gross from tot),0), 2) d_raw
    from grp g
  ),
  adj as (
    select rate, base0, vat0, incl,
           d_raw + case when rn = 1
                        then (select d_incl from disc) - (select coalesce(sum(d_raw),0) from alloc)
                        else 0 end d_g
    from alloc
  )
  select rate,
         case when (select d_incl from disc) = 0 then base0
              else round((incl - d_g)/(1 + rate/100.0), 2) end,
         case when (select d_incl from disc) = 0 then vat0
              else (incl - d_g) - round((incl - d_g)/(1 + rate/100.0), 2) end
  from adj;
$$;

-- 4. recompute a document's header totals from its lines + order discount ─────
create or replace function app.recompute_doc_totals(p_doc uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
  update public.documents d
     set subtotal_excl = coalesce(g.sub,0),
         vat_total     = coalesce(g.vat,0),
         total_incl    = coalesce(g.sub,0) + coalesce(g.vat,0)
  from (select sum(base) sub, sum(vat) vat from app.discounted_vat_groups(p_doc)) g
  where d.id = p_doc;
end $$;

-- 5. line-change trigger delegates to the shared recompute ────────────────────
create or replace function app.recompute_document_totals() returns trigger
language plpgsql as $$
begin
  perform app.recompute_doc_totals(coalesce(new.document_id, old.document_id));
  return null;
end $$;

-- 6. an order-discount change recomputes too ─────────────────────────────────
create or replace function app.recompute_doc_on_discount() returns trigger
language plpgsql as $$
begin
  if new.discount_kind is distinct from old.discount_kind
     or new.discount_value is distinct from old.discount_value then
    perform app.recompute_doc_totals(new.id);
  end if;
  return null;
end $$;
drop trigger if exists trg_doc_discount on documents;
create trigger trg_doc_discount after update of discount_kind, discount_value on documents
  for each row execute function app.recompute_doc_on_discount();
