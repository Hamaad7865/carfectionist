-- Re-pricing must not carry dead payments.
--
-- BUGHUNT C1: convert_quote_to_job's OUT-mirror loop skips payments that were
-- already reversed (NOT EXISTS on reverses_payment_id), but the carry-onto-the-
-- new-bill SELECT below it only filtered amount > 0 AND reverses_payment_id IS
-- NULL. A payment reversed earlier (partial refund) was carried onto the new
-- bill while v_carried excluded it — the new bill overstated amount_paid and
-- could flip to paid early. One predicate, same shape as the loop above it.
do $$
declare
  v_def text;
  v_old text := E'           where p.tenant_id = v_tenant and p.document_id = v_old.id\n             and p.amount > 0 and p.reverses_payment_id is null;\n          update public.documents d';
  v_new text := E'           where p.tenant_id = v_tenant and p.document_id = v_old.id\n             and p.amount > 0 and p.reverses_payment_id is null\n             and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id);\n          update public.documents d';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'convert_quote_to_job'
     and p.oid::regprocedure::text = 'convert_quote_to_job(uuid,uuid,timestamp with time zone,jsonb)';
  if v_def is null then raise exception 'public.convert_quote_to_job(uuid,uuid,timestamptz,jsonb) not found'; end if;

  -- Already carrying correctly (re-run, or a future rewrite kept it).
  if position('and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id);' in v_def) > 0 then
    raise notice 'convert_quote_to_job already skips reversed payments — nothing to do';
  else
    if position(v_old in v_def) = 0 then
      raise exception 'carry anchor not found in convert_quote_to_job — guard NOT installed';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end $$;
