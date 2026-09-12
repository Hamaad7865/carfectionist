-- Re-accept refuses for a removed car on every path, deterministically.
--
-- BUGHUNT M4 follow-up, found by the probe: with only one car left quoted,
-- convert_quote_to_jobs delegates to the singular path, whose idempotent
-- lookup has no ORDER BY — which stale job (if any) gets returned is a coin
-- toss, and the reconcile's stale check never runs. So (1) the plural checks
-- for stale cars BEFORE delegating, and (2) the singular lookup takes the
-- oldest job deterministically instead of an arbitrary row.
do $$
declare
  v_def text;
begin
  -- (1) plural: stale check before the single-car delegation.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'convert_quote_to_jobs'
     and p.oid::regprocedure::text = 'convert_quote_to_jobs(uuid,uuid,timestamp with time zone,jsonb)';
  if v_def is null then raise exception 'convert_quote_to_jobs(uuid,uuid,timestamptz,jsonb) not found'; end if;

  if position('before the single-car delegation' in v_def) > 0 then
    raise notice 'convert_quote_to_jobs already checks stale cars first — nothing to do';
  else
    if position('  -- The ordinary quote: one car, one job, the path that has always run.' in v_def) = 0 then
      raise exception 'delegation anchor not found in convert_quote_to_jobs — guard NOT installed';
    end if;
    v_def := replace(
      v_def,
      '  -- The ordinary quote: one car, one job, the path that has always run.',
      E'  -- A live job for a car no longer quoted refuses on ANY re-accept, even\n  -- when only one car remains: the singular path below cannot see the other\n  -- cars, so without this a removed car silently keeps its card.\n  select j.id, coalesce(v.plate, left(j.vehicle_id::text, 8)) into v_stale_id, v_stale_plate\n    from public.jobs j\n    left join public.vehicles v on v.id = j.vehicle_id\n   where j.source_quote_id = v_q.id and j.tenant_id = v_tenant and j.status <> ''cancelled''\n     and not exists (select 1 from app.document_cars(v_q.id) c where c.vehicle_id = j.vehicle_id)\n   limit 1;\n  if found then\n    raise exception ''car % is no longer on this quote — cancel job % first'', v_stale_plate, left(v_stale_id::text, 8);\n  end if;\n\n  -- The ordinary quote: one car, one job, the path that has always run.'
    );
    execute v_def;
  end if;

  -- (2) singular: deterministic oldest-first idempotent lookup.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'convert_quote_to_job'
     and p.oid::regprocedure::text = 'convert_quote_to_job(uuid,uuid,timestamp with time zone,jsonb)';
  if v_def is null then raise exception 'convert_quote_to_job(uuid,uuid,timestamptz,jsonb) not found'; end if;

  if position('order by created_at, id limit 1;' in v_def) > 0 then
    raise notice 'convert_quote_to_job lookup already deterministic — nothing to do';
  else
    if position('where source_quote_id = v_q.id and tenant_id = v_tenant' in v_def) = 0 then
      raise exception 'idempotency anchor not found in convert_quote_to_job — guard NOT installed';
    end if;
    -- The cancelled-exclusion from 20260910000060 is part of the matched text;
    -- this only appends the ordering, changing which row, never whether one.
    v_def := replace(
      v_def,
      'where source_quote_id = v_q.id and tenant_id = v_tenant and status <> ''cancelled'';',
      'where source_quote_id = v_q.id and tenant_id = v_tenant and status <> ''cancelled'' order by created_at, id limit 1;'
    );
    if position('order by created_at, id limit 1;' in v_def) = 0 then
      raise exception 'deterministic ordering did not apply — guard NOT installed';
    end if;
    execute v_def;
  end if;
end $$;
