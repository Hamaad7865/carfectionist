-- Convert idempotency must not resurrect dead jobs or hand back чужой ones.
--
-- BUGHUNT M2: the source_quote_id lookup had no status filter and ran before
-- the status gate, so retrying a cancelled job's (voided) quote handed the
-- cancelled job back instead of refusing. A cancelled job is history: it no
-- longer counts as "already converted", and the gate below either refuses the
-- dead quote or opens a fresh job for a live one. In the same breath: a job
-- for another vehicle is someone else's card — refuse rather than hand it
-- back (cancel the stale card first). Both checks read only, both fail closed.
do $$
declare
  v_def text;
  v_old text := E'  select * into v_job from public.jobs\n   where source_quote_id = v_q.id and tenant_id = v_tenant;\n  if found then\n    if v_sig is not null and v_q.accepted_signature is null then\n      update public.documents set accepted_signature = v_sig where id = v_q.id;\n    end if;\n    return v_job;\n  end if;';
  v_new text := E'  -- A cancelled job is history, not idempotency: fall through so the\n  -- status gate below either refuses a dead quote or opens a fresh job.\n  -- A job for another vehicle is someone else''s card: refuse rather than\n  -- hand it back (cancel the stale card first).\n  select * into v_job from public.jobs\n   where source_quote_id = v_q.id and tenant_id = v_tenant and status <> ''cancelled'';\n  if found then\n    if v_sig is not null and v_q.accepted_signature is null then\n      update public.documents set accepted_signature = v_sig where id = v_q.id;\n    end if;\n    if v_job.vehicle_id is not null and v_q.vehicle_id is not null\n       and v_job.vehicle_id is distinct from v_q.vehicle_id then\n      raise exception ''this quote already has a job for another vehicle — cancel that card first'';\n    end if;\n    return v_job;\n  end if;';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'convert_quote_to_job'
     and p.oid::regprocedure::text = 'convert_quote_to_job(uuid,uuid,timestamp with time zone,jsonb)';
  if v_def is null then raise exception 'convert_quote_to_job(uuid,uuid,timestamptz,jsonb) not found'; end if;

  if position('A cancelled job is history, not idempotency' in v_def) > 0 then
    raise notice 'convert_quote_to_job already skips dead jobs — nothing to do';
  else
    if position(v_old in v_def) = 0 then
      raise exception 'idempotency anchor not found in convert_quote_to_job — guard NOT installed';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end $$;
