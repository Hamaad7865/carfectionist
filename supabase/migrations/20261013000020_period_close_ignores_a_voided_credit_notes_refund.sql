-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — the period close stops counting the refund of a voided credit note.
--
-- Same rule as 20261013000010 put on the Z, for the same row: CN-0004's −1,215.00
-- Juice mirror stays in the append-only ledger after the credit note was voided.
-- close_period already leaves a voided credit note out of its `credit_notes`
-- figure, but sums `payments_by_method` and `takings_by_device` over every
-- payment in the month — so October would close with Juice Rs 1,215 below the
-- Sales Journal and the Z.
--
-- Spliced onto the live body: marker first (a second run is a no-op), then two
-- anchors that must each match exactly once.
-- ═══════════════════════════════════════════════════════════════════════════

do $do$
declare
  v_n   int;
  v_def text;
  v_was text;
  v_acl text;
  v_oid oid;
  v_method_anchor text := E'            where tenant_id = v_tenant and received_at >= v_start and received_at < v_end\n';
  v_method_fix    text := $f$              -- not the refund of a credit note that was later voided (as the Z and the journal)
              and not exists (select 1 from public.documents vd
                               where vd.id = payments.document_id and vd.doc_type = 'credit_note' and vd.status = 'void')
$f$;
  v_device_anchor text := E'            where p.tenant_id = v_tenant and p.received_at >= v_start and p.received_at < v_end\n';
  v_device_fix    text := $f$              and not exists (select 1 from public.documents vd
                               where vd.id = p.document_id and vd.doc_type = 'credit_note' and vd.status = 'void')
$f$;
begin
  v_method_fix := replace(v_method_fix, E'\r', '');
  v_device_fix := replace(v_device_fix, E'\r', '');

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'close_period';
  if v_n <> 1 then
    raise exception 'close_period has % definitions, not 1 — resolve the overloads before splicing', v_n;
  end if;

  select p.oid, pg_get_functiondef(p.oid), p.proacl::text into v_oid, v_def, v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'close_period';
  if position(E'\r' in v_def) > 0 then
    raise exception 'close_period: the installed body has CRLF line endings — the anchors below assume LF';
  end if;
  v_was := v_def;

  if position('vd.id = payments.document_id' in v_def) = 0 then
    v_n := (length(v_def) - length(replace(v_def, v_method_anchor, ''))) / length(v_method_anchor);
    if v_n <> 1 then
      raise exception 'close_period: the payments_by_method anchor matches % times, not 1 — nothing was changed', v_n;
    end if;
    v_def := replace(v_def, v_method_anchor, v_method_anchor || v_method_fix);
  end if;

  if position('vd.id = p.document_id' in v_def) = 0 then
    v_n := (length(v_def) - length(replace(v_def, v_device_anchor, ''))) / length(v_device_anchor);
    if v_n <> 1 then
      raise exception 'close_period: the takings_by_device anchor matches % times, not 1 — nothing was changed', v_n;
    end if;
    v_def := replace(v_def, v_device_anchor, v_device_anchor || v_device_fix);
  end if;

  if v_def is distinct from v_was then
    execute v_def;
  end if;

  if (select p.proacl::text from pg_proc p where p.oid = v_oid) is distinct from v_acl then
    raise exception 'close_period: the splice changed who may execute the function';
  end if;
end $do$;

-- ── prove it against what is actually installed ─────────────────────────────
do $$
declare
  v_def text;
  v_n   int;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'close_period';
  if v_n <> 1 then raise exception 'close_period has % definitions', v_n; end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'close_period';

  if position('vd.id = payments.document_id' in v_def) = 0
     or position('vd.id = p.document_id' in v_def) = 0 then
    raise exception 'close_period still counts the refund of a voided credit note';
  end if;
  -- Nothing it already did was lost.
  if position('''payments_by_method''' in v_def) = 0
     or position('''takings_by_device''' in v_def) = 0
     or position('''credit_notes''' in v_def) = 0
     or position('has not finished yet' in v_def) = 0
     or position('insert into public.period_closes' in v_def) = 0 then
    raise exception 'close_period lost one of its own parts';
  end if;
end $$;
