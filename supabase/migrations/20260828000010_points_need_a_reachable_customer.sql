-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — loyalty points need a customer you can reach.
--
-- Receipt INV-0142, a walk-in sale, printed "Points balance : 54 pts". The POS
-- bills every anonymous counter sale to a real customers row named "Walk-in
-- customer" (issueWalkInInvoice) rather than to customer_id IS NULL — 61 of 274
-- invoices, across two such rows. Because they are real rows,
-- app.award_points_for_invoice credited them and the web receipt printed the
-- balance.
--
-- The rule: a customer with NO phone and NO email is anonymous — a walk-in with
-- a name typed in — and is not on the loyalty programme, exactly like
-- customer_id IS NULL (which both functions already handle). Chosen over matching
-- the name string: robust to localisation/rename, and it also catches a
-- cashier-typed walk-in name. A real customer with neither detail yet starts
-- earning the moment one is added.
--
-- Both bodies are read from the live catalogue and put back with one clause
-- added — the same splice mechanism as 20260811000090 (the points off-switch) —
-- so nothing else in them can drift while this runs. Idempotent: the marker
-- text short-circuits a re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── award_points_for_invoice: an unreachable customer earns nothing, quietly ──
do $$
declare v_def text; v_anchor text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'award_points_for_invoice';
  if v_def is null then raise exception 'app.award_points_for_invoice not found'; end if;
  if position('a walk-in with' in v_def) > 0 then return; end if; -- already guarded

  v_anchor := 'if not found or v_doc.customer_id is null then return; end if;';
  if position(v_anchor in v_def) = 0 then
    raise exception 'award_points_for_invoice: the customer_id anchor was not found';
  end if;

  v_def := replace(v_def, v_anchor,
    v_anchor || E'\n' ||
    '  -- No phone and no email on the named customer: it is anonymous — a walk-in with' || E'\n' ||
    '  -- a name typed in — and earns nothing, exactly like customer_id IS NULL above.' || E'\n' ||
    '  if not exists (' || E'\n' ||
    '    select 1 from public.customers' || E'\n' ||
    '     where id = v_doc.customer_id' || E'\n' ||
    '       and (nullif(btrim(phone), '''') is not null or nullif(btrim(email), '''') is not null)' || E'\n' ||
    '  ) then return; end if;');

  execute v_def;
end $$;

-- ── spend_points: a points tender on such a bill is a mistake, not a shortfall ──
do $$
declare v_def text; v_anchor text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'spend_points';
  if v_def is null then raise exception 'app.spend_points not found'; end if;
  if position('not on the loyalty programme' in v_def) > 0 then return; end if;

  v_anchor := 'raise exception ''a points payment needs a customer on the bill'';';
  if position(v_anchor in v_def) = 0 then
    raise exception 'spend_points: the customer_id anchor was not found';
  end if;

  v_def := replace(v_def, v_anchor || E'\n  end if;',
    v_anchor || E'\n  end if;' || E'\n' ||
    '  -- An anonymous customer (no phone, no email) is not on the programme.' || E'\n' ||
    '  if not exists (' || E'\n' ||
    '    select 1 from public.customers' || E'\n' ||
    '     where id = v_doc.customer_id' || E'\n' ||
    '       and (nullif(btrim(phone), '''') is not null or nullif(btrim(email), '''') is not null)' || E'\n' ||
    '  ) then' || E'\n' ||
    '    raise exception ''this customer is not on the loyalty programme (no phone or email)'';' || E'\n' ||
    '  end if;');

  execute v_def;
end $$;

-- ── prove both landed the way they read ──────────────────────────────────────
do $$
declare v_award text; v_spend text;
begin
  select pg_get_functiondef(p.oid) into v_award from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'award_points_for_invoice';
  select pg_get_functiondef(p.oid) into v_spend from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'spend_points';

  if position('a walk-in with' in v_award) = 0 then
    raise exception 'award_points_for_invoice still earns for an unreachable customer';
  end if;
  -- The pre-existing guards must survive the splice.
  if position('points_enabled' in v_award) = 0 or position('customer_id is null' in v_award) = 0 then
    raise exception 'award_points_for_invoice lost a guard while gaining the reachability check';
  end if;
  if position('not on the loyalty programme' in v_spend) = 0 then
    raise exception 'spend_points still spends for an unreachable customer';
  end if;
  if position('points are switched off' in v_spend) = 0 then
    raise exception 'spend_points lost its off-switch guard while gaining the reachability check';
  end if;
end $$;
