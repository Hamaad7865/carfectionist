-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — every line carries a discount allowance.
--
-- The owner's rules 1 and 2 are two values of one idea: the most, in
-- VAT-inclusive rupees, that a line may be given away. A document's ceiling is
-- the sum of its lines', which is what closes the back door — the whole-document
-- discount field spreads across every line, services included, so governing only
-- the line inputs would leave 'Discount (whole quote)' free to do what rule 1
-- forbids.
--
-- Two thresholds, not one:
--   actual > free_incl     -> the discount is reaching into a carwash allowance,
--                             so a reason is required (rule 2).
--   actual > ceiling_incl  -> only the owner can allow it (rules 1 and 2).
-- Keeping them apart is what stops the reason box nagging on a bill whose
-- discount is entirely covered by its goods lines.
--
-- NOTHING here recomputes a line's net. line_total_excl and line_vat are
-- generated columns and they are the authority; deriving the gross the same way
-- the generated columns derive an undiscounted line is what makes the discount
-- land on exactly 0 when there is no discount. Computing gross as
-- round(qty*unit*(1+rate/100), 2) instead drifts a cent on many qty>=2 lines and
-- would raise a phantom "discount" on documents that have none — the bug already
-- written up at QuoteScreen.kt:957.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.document_discount_limits(p_doc uuid)
returns table(ceiling_incl numeric, free_incl numeric, actual_incl numeric)
language sql stable set search_path = public, pg_temp as $$
  with l as (
    select
      round(dl.qty * dl.unit_price, 2)
        + round(round(dl.qty * dl.unit_price, 2) * dl.vat_rate / 100.0, 2) as gross_incl,
      dl.line_total_excl + dl.line_vat                                     as net_incl,
      coalesce(
        nullif(p.discount_policy, 'inherit'),
        case when coalesce(dl.line_kind, p.kind, 'service') = 'service'
             then 'none' else 'free' end
      ) as policy
    from public.document_lines dl
    left join public.products p on p.id = dl.product_id
    where dl.document_id = p_doc
  ),
  agg as (
    select
      coalesce(sum(case policy when 'free'    then gross_incl
                               when 'carwash' then round(gross_incl * 0.05, 2)
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

comment on function app.document_discount_limits(uuid) is
  'What this document may be discounted (ceiling_incl), how much of that comes from unrestricted goods lines (free_incl), and what it actually carries across line and order discounts (actual_incl). All VAT-inclusive rupees.';

-- ─── the guard ──────────────────────────────────────────────────────────────
create or replace function app.assert_discount_allowed(p_doc uuid) returns void
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_doc      public.documents;
  v_lim      record;
  v_approved numeric;
  v_allowed  numeric;
begin
  select * into v_doc from public.documents where id = p_doc;
  if not found then return; end if;

  -- A credit note mirrors the invoice it reverses. Re-earning an approval the
  -- invoice already carried would block a legitimate refund.
  if v_doc.doc_type = 'credit_note' then return; end if;

  select * into v_lim from app.document_discount_limits(p_doc);
  if coalesce(v_lim.actual_incl, 0) <= 0.01 then return; end if;

  select max((scope->>'max_discount_incl')::numeric) into v_approved
    from public.owner_overrides
   where tenant_id = v_doc.tenant_id and kind = 'discount'
     and ref_type = 'document' and ref_id = p_doc;

  v_allowed := greatest(v_lim.ceiling_incl, coalesce(v_approved, 0));

  -- 1 cent of tolerance absorbs the rounding of a many-line document.
  if v_lim.actual_incl > v_allowed + 0.01 then
    raise exception 'discount exceeds allowance: Rs % requested, Rs % allowed',
      to_char(v_lim.actual_incl, 'FM999999990.00'), to_char(v_allowed, 'FM999999990.00');
  end if;

  -- An override carries its own reason, so it answers this too.
  if v_approved is null
     and v_lim.actual_incl > v_lim.free_incl + 0.01
     and coalesce(trim(v_doc.discount_reason), '') = '' then
    raise exception 'a reason is required for a carwash discount';
  end if;
end $$;
