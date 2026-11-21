-- The end-of-day (Z) report per issuing company (tyre centre: the VAT tyre company and the non-VAT
-- service company), beside the combined figures it already holds.
--
-- app.z_totals gains a 'companies' key ONLY for a tenant with more than one active company. A
-- one-company shop (Carfectionist, the HAZ demo) gets exactly the JSON it got before — its stored
-- Z reports and every new one are unchanged.
--
-- Per company: tickets, sales (incl / excl / VAT, credit notes netted), refunds, and the money taken
-- against that company's bills by means of payment. A payment belongs to the company of the bill it
-- settles; a document without a company (history) is the default company's.

create or replace function pg_temp.splice(p_schema text, p_name text, p_marker text, p_pairs text[])
returns void language plpgsql as $$
declare
  v_def text; v_n int; i int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = p_schema and p.proname = p_name;
  if v_n <> 1 then raise exception '%.% has % definitions, not 1', p_schema, p_name, v_n; end if;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = p_schema and p.proname = p_name;
  if position(chr(13) in v_def) > 0 then raise exception '%.%: CRLF body', p_schema, p_name; end if;
  if position(p_marker in v_def) > 0 then return; end if;
  i := 1;
  while i < array_length(p_pairs, 1) loop
    v_n := (length(v_def) - length(replace(v_def, p_pairs[i], ''))) / length(p_pairs[i]);
    if v_n <> 1 then
      raise exception '%.%: anchor % matches % times, not 1 — nothing was changed: %', p_schema, p_name, (i + 1) / 2, v_n, p_pairs[i];
    end if;
    v_def := replace(v_def, p_pairs[i], p_pairs[i + 1]);
    i := i + 2;
  end loop;
  if position(p_marker in v_def) = 0 then raise exception '%.%: marker missing after splice', p_schema, p_name; end if;
  execute v_def;
end $$;

select pg_temp.splice('app', 'z_totals', 'per issuing company (two-company shops only)', array[
  $s$  return v_out;$s$,
  $s$  -- per issuing company (two-company shops only): a one-company shop's Z is unchanged.
  if (select count(*) from public.legal_entities le where le.tenant_id = p_tenant and le.is_active) > 1 then
    v_out := v_out || jsonb_build_object('companies', (
      select coalesce(jsonb_agg(x.j order by x.so, x.id), '[]'::jsonb)
        from (
          select le.id, le.sort_order as so, jsonb_build_object(
                   'id',             le.id,
                   'name',           coalesce(nullif(btrim(le.trading_name), ''), le.legal_name),
                   'legal_name',     le.legal_name,
                   'vat_registered', le.vat_registered,
                   'tickets',        (select count(*) from public.documents d
                                       where d.id = any(v_docs) and coalesce(d.legal_entity_id, def.id) = le.id),
                   'total_incl',     (select round(coalesce(sum(d.total_incl * case when d.doc_type = 'credit_note' then -1 else 1 end), 0), 2)
                                        from public.documents d
                                       where (d.id = any(v_docs) or d.id = any(v_cn_docs)) and coalesce(d.legal_entity_id, def.id) = le.id),
                   'excl',           (select round(coalesce(sum(d.subtotal_excl * case when d.doc_type = 'credit_note' then -1 else 1 end), 0), 2)
                                        from public.documents d
                                       where (d.id = any(v_docs) or d.id = any(v_cn_docs)) and coalesce(d.legal_entity_id, def.id) = le.id),
                   'vat',            (select round(coalesce(sum(d.vat_total * case when d.doc_type = 'credit_note' then -1 else 1 end), 0), 2)
                                        from public.documents d
                                       where (d.id = any(v_docs) or d.id = any(v_cn_docs)) and coalesce(d.legal_entity_id, def.id) = le.id),
                   'refunds',        (select round(coalesce(sum(d.total_incl), 0), 2) from public.documents d
                                       where d.id = any(v_cn_docs) and coalesce(d.legal_entity_id, def.id) = le.id),
                   'methods',        (select coalesce(jsonb_agg(jsonb_build_object('method', m.method, 'net', m.net) order by m.method), '[]'::jsonb)
                                        from (select pm.method::text as method, round(sum(pm.amount), 2) as net
                                                from public.payments pm
                                                join public.documents d on d.id = pm.document_id
                                               where pm.id = any(v_pays) and coalesce(d.legal_entity_id, def.id) = le.id
                                               group by pm.method) m)
                 ) as j
            from public.legal_entities le
           cross join (select e.id from public.legal_entities e where e.tenant_id = p_tenant and e.is_default) def
           where le.tenant_id = p_tenant and le.is_active
        ) x));
  end if;
  return v_out;$s$
]);

-- The month close (close_period) — same rule: a 'companies' key for a two-company shop only.
select pg_temp.splice('public', 'close_period', 'month per issuing company (two-company shops only)', array[
  $s$  ) into v_totals;$s$,
  $s$  ) into v_totals;

  -- month per issuing company (two-company shops only): a one-company shop's close is unchanged.
  if (select count(*) from public.legal_entities le where le.tenant_id = v_tenant and le.is_active) > 1 then
    v_totals := v_totals || jsonb_build_object('companies', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id',             le.id,
               'name',           coalesce(nullif(btrim(le.trading_name), ''), le.legal_name),
               'vat_registered', le.vat_registered,
               'invoices', (select jsonb_build_object('count', count(*), 'revenue', coalesce(sum(d.total_incl), 0), 'vat', coalesce(sum(d.vat_total), 0))
                              from public.documents d
                             where d.tenant_id = v_tenant and d.doc_type = 'invoice' and d.status <> 'void'
                               and d.issued_at >= v_start and d.issued_at < v_end
                               and coalesce(d.legal_entity_id, def.id) = le.id),
               'credit_notes', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(d.total_incl), 0))
                                  from public.documents d
                                 where d.tenant_id = v_tenant and d.doc_type = 'credit_note' and d.status <> 'void'
                                   and d.issued_at >= v_start and d.issued_at < v_end
                                   and coalesce(d.legal_entity_id, def.id) = le.id),
               'payments_by_method', (select coalesce(jsonb_object_agg(m.method, m.amt), '{}'::jsonb)
                                        from (select pm.method::text as method, sum(pm.amount) as amt
                                                from public.payments pm
                                                join public.documents d on d.id = pm.document_id
                                               where pm.tenant_id = v_tenant and pm.received_at >= v_start and pm.received_at < v_end
                                                 and not (d.doc_type = 'credit_note' and d.status = 'void')
                                                 and coalesce(d.legal_entity_id, def.id) = le.id
                                               group by pm.method) m)
             ) order by le.sort_order, le.id), '[]'::jsonb)
        from public.legal_entities le
       cross join (select e.id from public.legal_entities e where e.tenant_id = v_tenant and e.is_default) def
       where le.tenant_id = v_tenant and le.is_active));
  end if;$s$
]);

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'app' and p.proname = 'z_totals'
                    and p.prosrc like '%per issuing company (two-company shops only)%') then
    raise exception 'z_totals splice missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'close_period'
                    and p.prosrc like '%month per issuing company (two-company shops only)%') then
    raise exception 'close_period splice missing';
  end if;
end $$;
