-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — the POS rules become owner-editable, read live by the tablet.
--
-- The carwash cap, the per-kind default policies and the reversal rule were all
-- hardcoded: 0.95 baked into app.document_discount_limits, service→none/else→free
-- inline, and app.require_owner_or_override always allowing a manager's approved
-- override. This lifts them onto business_settings so the owner sets them once and
-- both clients read them.
--
-- EVERY new column defaults to the value it was hardcoded to, so a shop that never
-- opens the new screen keeps exactly today's behaviour. The arithmetic in the
-- allowance function is unchanged — only its 0.95 and its two policy literals now
-- come from the row instead of the source.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the columns ─────────────────────────────────────────────────────────
alter table public.business_settings
  add column if not exists discount_carwash_pct   numeric(5,2)  not null default 5
    check (discount_carwash_pct >= 0 and discount_carwash_pct <= 100),
  add column if not exists default_policy_service  text          not null default 'none'
    check (default_policy_service in ('none','carwash','free')),
  add column if not exists default_policy_goods    text          not null default 'free'
    check (default_policy_goods in ('none','carwash','free')),
  add column if not exists allow_discount_override boolean       not null default true,
  add column if not exists allow_negative_stock    boolean       not null default true,
  add column if not exists default_opening_float   numeric(12,2) not null default 0
    check (default_opening_float >= 0),
  add column if not exists reversal_requires_owner boolean       not null default false;

comment on column public.business_settings.discount_carwash_pct is
  'The carwash discount cap, in percent. A carwash line may be discounted up to this much, with a reason. Was a hardcoded 5.';
comment on column public.business_settings.default_policy_service is
  'What an inherit-policy SERVICE line falls back to when no product policy is set. Was a hardcoded none.';
comment on column public.business_settings.default_policy_goods is
  'What an inherit-policy PRODUCT/CONSUMABLE line falls back to. Was a hardcoded free.';
comment on column public.business_settings.reversal_requires_owner is
  'On: only an owner may reverse a payment — a manager''s PIN-approved override no longer opens the door. Off (default): owner-or-override, as shipped.';

-- ── 2. the allowance function reads the cap + the defaults ──────────────────
-- Rewritten wholesale (a pure SQL function, no plpgsql to drift) with a single
-- cfg row cross-joined into the line CTE. cfg uses a LEFT JOIN + coalesce so it
-- always yields one row and the hardcoded fallbacks survive even a tenant with no
-- settings row — the allowance can never collapse to zero for a missing config.
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
      round(dl.qty * dl.unit_price, 2)
        + round(round(dl.qty * dl.unit_price, 2) * dl.vat_rate / 100.0, 2) as gross_incl,
      -- What a discount at the CAP actually leaves behind, rounded exactly as
      -- line_total_excl and line_vat are. gross_incl minus this is the most a
      -- carwash may give away. At the default 5 percent cap the factor equals
      -- the previous fixed multiplier byte-for-byte.
      round(dl.qty * dl.unit_price * (1 - cfg.carwash_pct / 100.0), 2)
        + round(round(dl.qty * dl.unit_price * (1 - cfg.carwash_pct / 100.0), 2) * dl.vat_rate / 100.0, 2) as net_at_max,
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

comment on function app.document_discount_limits(uuid) is
  'What this document may be discounted (ceiling_incl), how much comes from unrestricted goods lines (free_incl), and what it actually carries (actual_incl). All VAT-inclusive rupees. The carwash cap and the per-kind default policies are read from business_settings (discount_carwash_pct / default_policy_service / default_policy_goods), defaulting to 5% / none / free.';

-- ── 3. the reversal rule honours the toggle ────────────────────────────────
-- With reversal_requires_owner on, a non-owner is refused before the override is
-- even consulted, so a manager's PIN-approved override no longer authorises a
-- refund. Off (the default) keeps the shipped owner-or-override behaviour.
create or replace function app.require_owner_or_override(p_ref_type text, p_ref_id uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_strict boolean;
  v_over   public.owner_overrides;
begin
  if app.current_user_role() = 'owner' then return; end if;

  select coalesce(bs.reversal_requires_owner, false) into v_strict
    from public.business_settings bs where bs.id = v_tenant;
  if v_strict then
    raise exception 'reversal requires the owner';
  end if;

  select * into v_over from public.owner_overrides
   where tenant_id = v_tenant and kind = 'reversal'
     and ref_type = p_ref_type and ref_id = p_ref_id and consumed_at is null
   order by created_at limit 1
   for update;

  if not found then
    raise exception 'reversal requires the owner';
  end if;

  -- Single use: one approval must not authorise a second refund.
  update public.owner_overrides set consumed_at = now() where id = v_over.id;
end $$;

-- ── 4. prove the parameterisation landed ───────────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'document_discount_limits';
  if position('cfg.carwash_pct' in v_def) = 0 then
    raise exception 'document_discount_limits still uses a hardcoded cap';
  end if;
  if position('0.95' in v_def) > 0 then
    raise exception 'document_discount_limits still carries the 0.95 literal';
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'require_owner_or_override';
  if position('reversal_requires_owner' in v_def) = 0 then
    raise exception 'require_owner_or_override does not read the strict toggle';
  end if;
end $$;
