-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — the Z stops counting the refund of a credit note that was voided.
--
-- CN-0004 was raised by mistake on 2026-10-05 (a job cancelled as "Duplicate of
-- checkout" credit-notes its paid bill) and voided on 2026-10-12. Its refund row
-- — a −1,215.00 Juice mirror — cannot leave the append-only ledger.
--
-- app.z_totals already leaves a voided credit note out of the SALES (its
-- v_cn_docs is `status <> 'void'`), but gathers the MONEY by till alone, so the
-- same Z read "no refund, Rs 19,525.50 sold" over a Juice line still short by
-- the refund. The Sales Journal drops money against a document that is not live
-- and reads Rs 8,660.50; the Z read Rs 7,445.50. One rule now, on both: the
-- mirrors of a voided credit note are not money that moved.
--
-- Only that. A voided INVOICE can carry a payment and its reversal — real money
-- in and real money out of a real drawer — and both keep counting.
--
-- Spliced onto the live body, the way 20261012000010 does it and for the same
-- reason: marker first (a second run is a no-op), then an anchor that must match
-- exactly once.
-- ═══════════════════════════════════════════════════════════════════════════

do $do$
declare
  v_n   int;
  v_def text;
  v_was text;
  v_anchor text := E'    from public.payments pm\n   where pm.tenant_id = p_tenant\n     and pm.received_at <= p_as_at\n';
  v_fix    text := $f$     -- The refund of a credit note that was later voided is not money that moved:
     -- the row stays (payments are append-only) and counts for nothing, as in the
     -- Sales Journal.
     and not exists (
           select 1 from public.documents vd
            where vd.id = pm.document_id and vd.doc_type = 'credit_note' and vd.status = 'void')
$f$;
begin
  v_fix := replace(v_fix, E'\r', '');

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'z_totals';
  if v_n <> 1 then
    raise exception 'app.z_totals has % definitions, not 1 — resolve them before splicing', v_n;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'z_totals';
  if position(E'\r' in v_def) > 0 then
    raise exception 'app.z_totals: the installed body has CRLF line endings — the anchor below assumes LF';
  end if;
  v_was := v_def;

  if position('vd.doc_type = ''credit_note'' and vd.status = ''void''' in v_def) = 0 then
    v_n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
    if v_n <> 1 then
      raise exception 'app.z_totals: the payments anchor matches % times, not 1 — nothing was changed', v_n;
    end if;
    v_def := replace(v_def, v_anchor, v_anchor || v_fix);
  end if;

  if v_def is distinct from v_was then
    execute v_def;
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
   where n.nspname = 'app' and p.proname = 'z_totals';
  if v_n <> 1 then raise exception 'app.z_totals has % definitions', v_n; end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'z_totals';

  if position('vd.doc_type = ''credit_note'' and vd.status = ''void''' in v_def) = 0 then
    raise exception 'app.z_totals still counts the refund of a voided credit note';
  end if;
  -- Nothing it already did was lost.
  if position('pm.booked_session_id = p_session' in v_def) = 0
     or position('d.doc_type = ''credit_note''' in v_def) = 0
     or position('''voided_bills''' in v_def) = 0
     or position('''refunds''' in v_def) = 0 then
    raise exception 'app.z_totals lost one of its own parts';
  end if;
end $$;
