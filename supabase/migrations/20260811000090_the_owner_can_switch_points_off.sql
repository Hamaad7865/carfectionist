-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — the points programme has an off switch.
--
-- Until now a shop that did not want a loyalty scheme could only set
-- points_per_100 to zero. That stops the EARNING and nothing else: the tender
-- stays on the pad, every balance already given out stays spendable, and there
-- is no single thing the owner can point at and call "off".
--
-- business_settings.points_enabled is that thing. It defaults to TRUE, so every
-- shop keeps exactly the behaviour it has today until someone decides otherwise.
--
-- OFF means off, in both directions:
--   • app.award_points_for_invoice returns quietly — a settled bill simply earns
--     nothing. Silence is right here: earning is a bonus nobody asked for, and
--     raising would fail the SALE over a loyalty scheme that is switched off.
--   • app.spend_points RAISES. A cashier who taps points on a bill asked for
--     something the shop no longer does, and must be told so plainly rather than
--     watch a tender disappear with no explanation.
--
-- DELIBERATELY UNGUARDED: app.unwind_points_for_payment. A reversal undoes what
-- already happened, and what happened happened while the scheme was on. Gating
-- it would mean that switching points off mid-week stranded every point taken
-- before the switch — reversing a sale would leave the customer's redemption
-- spent and unrefunded, which is money, not loyalty.
--
-- Balances are kept, never cleared. Switching back on restores every customer's
-- balance exactly as it stood, and the ledger stays a complete record either way.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.business_settings
  add column if not exists points_enabled boolean not null default true;

comment on column public.business_settings.points_enabled is
  'The loyalty programme''s off switch. False: bills earn nothing and points cannot be spent. Balances are kept, and reversals still refund what was already taken.';

-- ── the guard, spliced in rather than retyped ──────────────────────────────
-- Both bodies are read from the live catalogue and put back with one clause
-- added, so nothing else in them can drift while this runs.

do $$
declare v_def text; v_anchor text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'award_points_for_invoice';
  if v_def is null then raise exception 'app.award_points_for_invoice not found'; end if;
  if position('points_enabled' in v_def) > 0 then return; end if; -- already carries the switch

  v_anchor := '  select points_per_100 into v_rate from public.business_settings where id = v_doc.tenant_id;';
  if position(v_anchor in v_def) = 0 then
    raise exception 'award_points_for_invoice: rate lookup not found — the switch would not be read';
  end if;

  v_def := replace(v_def, v_anchor,
    '  -- The programme is off: a settled bill earns nothing, quietly.' || E'\n' ||
    '  if not coalesce((select points_enabled from public.business_settings where id = v_doc.tenant_id), true) then' || E'\n' ||
    '    return;' || E'\n' ||
    '  end if;' || E'\n' || v_anchor);

  execute v_def;
end $$;

do $$
declare v_def text; v_anchor text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'spend_points';
  if v_def is null then raise exception 'app.spend_points not found'; end if;
  if position('points_enabled' in v_def) > 0 then return; end if;

  v_anchor := '  select point_value_rupees into v_value from public.business_settings where id = v_doc.tenant_id;';
  if position(v_anchor in v_def) = 0 then
    raise exception 'spend_points: value lookup not found — the switch would not be read';
  end if;

  v_def := replace(v_def, v_anchor,
    '  -- The programme is off: say so, rather than let a tender vanish unexplained.' || E'\n' ||
    '  if not coalesce((select points_enabled from public.business_settings where id = v_doc.tenant_id), true) then' || E'\n' ||
    '    raise exception ''points are switched off'';' || E'\n' ||
    '  end if;' || E'\n' || v_anchor);

  execute v_def;
end $$;

-- ── prove it landed the way it reads ──────────────────────────────────────
do $$
declare v_award text; v_spend text; v_unwind text;
begin
  select pg_get_functiondef(p.oid) into v_award from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'award_points_for_invoice';
  select pg_get_functiondef(p.oid) into v_spend from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'spend_points';
  select pg_get_functiondef(p.oid) into v_unwind from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'unwind_points_for_payment';

  if position('points_enabled' in v_award) = 0 then
    raise exception 'award_points_for_invoice still earns while the programme is off';
  end if;
  if position('points are switched off' in v_spend) = 0 then
    raise exception 'spend_points still spends while the programme is off';
  end if;
  -- The one that must NOT have it: a reversal always refunds.
  if position('points_enabled' in v_unwind) > 0 then
    raise exception 'unwind_points_for_payment was gated — reversals would strand points taken before the switch';
  end if;
end $$;
