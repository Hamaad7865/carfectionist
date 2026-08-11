-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a carwash at 5% must not be refused for being 5%.
--
-- 20260810000040 set a carwash line's allowance to round(gross * 0.05, 2). But
-- the discount a 5% line ACTUALLY takes off the bill is not that number: the
-- generated columns round the discounted net and then round its VAT, so the
-- inclusive reduction lands a cent away from "5% of the gross".
--
--   TOUCHLESS FOAM WASH SEDAN, Rs 1,173.91 net, 15% VAT
--     gross incl                     1350.00
--     net incl at 5%                 1282.49
--     actually discounted              67.51   <- what the bill shows
--     allowance, round(gross*.05)      67.50   <- what the guard allowed
--
-- One line squeaked through on the guard's 1-cent tolerance. Two did not:
-- 135.02 against 135.00, refused. Three: 202.53 against 202.50, refused. So a
-- customer with two cars, or a wash plus a vacuum, could not be given the
-- discount the shop is expressly allowed to give — and the message blamed the
-- cashier for asking.
--
-- The tolerance was never the right instrument. It exists to absorb rounding
-- ACROSS a many-line document, not to paper over a systematic per-line drift
-- that grows with every line added.
--
-- So the allowance is now derived the same way the discount is applied:
-- gross_incl minus the net a CARWASH_MAX_PCT discount produces, rounded exactly
-- as line_total_excl and line_vat round. 5% then hits its ceiling precisely, at
-- any number of lines, and the tolerance goes back to doing only its own job.
--
-- Mirrored in the same commit in apps/web/src/lib/money/allowance.ts and
-- android/.../core/money/Allowance.kt — the three must agree or the tills argue.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.document_discount_limits(p_doc uuid)
returns table(ceiling_incl numeric, free_incl numeric, actual_incl numeric)
language sql stable set search_path = public, pg_temp as $$
  with l as (
    select
      round(dl.qty * dl.unit_price, 2)
        + round(round(dl.qty * dl.unit_price, 2) * dl.vat_rate / 100.0, 2) as gross_incl,
      -- What a 5% line discount actually leaves behind, rounded exactly as
      -- line_total_excl and line_vat are. The difference from gross_incl IS the
      -- most a carwash may give away — not round(gross * 0.05, 2), which drifts.
      round(dl.qty * dl.unit_price * 0.95, 2)
        + round(round(dl.qty * dl.unit_price * 0.95, 2) * dl.vat_rate / 100.0, 2) as net_at_max,
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

comment on function app.document_discount_limits(uuid) is
  'What this document may be discounted (ceiling_incl), how much of that comes from unrestricted goods lines (free_incl), and what it actually carries across line and order discounts (actual_incl). All VAT-inclusive rupees. A carwash line''s allowance is what a 5% discount genuinely removes, not 5% of its gross — the two differ by a cent per line once VAT is rounded.';
