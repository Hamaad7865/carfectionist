-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a cash-out is measured against the drawer it leaves.
--
-- Third function found reverted by the 2026-09-10 history repair (see
-- 20261012000010 for how). The installed record_till_cash_out is the
-- till_movements body of 12 July, line for line; its catalog row was last
-- written by transaction 442207, four transactions before the one that reverted
-- app.jobs_guard and, like it, ahead of the tracked push with no tracker row of
-- its own. 20260716000060, which corrected it, was already marked applied and
-- did not run again.
--
-- What that correction was: "never take out more than the drawer holds" summed
-- the drawer's cash by payments.cash_session_id — the till that TOOK the money.
-- Every reconciliation (close_cash_session, the Z) sums by booked_session_id —
-- the till the row MOVES. They differ for exactly one kind of row, a refund paid
-- out of this drawer for a sale another service took. Such a refund is invisible
-- to the stale sum, so the ceiling stands too high by the refund and a cash-out
-- can be approved for more than is physically there.
--
-- Spliced onto the live body: marker first, then an anchor that must match
-- exactly once. The result is 20260716000060's body character for character;
-- scripts/_verify-cash-out-ceiling.mjs compares the two.
-- ═══════════════════════════════════════════════════════════════════════════

do $do$
declare
  v_oid oid;
  v_n   int;
  v_def text;
  v_was text;
  v_acl text;
  v_anchor text := $a$  select coalesce(sum(amount),0) into v_cash
    from public.payments where cash_session_id = p_session_id and method = 'cash';
$a$;
  v_fix    text := $a$  -- BOOKED to this drawer — the axis close_cash_session and the Z reconcile on. The old
  -- cash_session_id sum missed refunds booked in from elsewhere and counted payments
  -- whose money was booked out.
  select coalesce(sum(amount),0) into v_cash
    from public.payments where booked_session_id = p_session_id and method = 'cash';
$a$;
begin
  v_anchor := replace(v_anchor, E'\r', '');
  v_fix    := replace(v_fix,    E'\r', '');

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_till_cash_out';
  if v_n <> 1 then
    raise exception 'record_till_cash_out has % definitions, not 1 — resolve the overloads before splicing', v_n;
  end if;

  select p.oid, pg_get_functiondef(p.oid), p.proacl::text into v_oid, v_def, v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_till_cash_out';
  if position(E'\r' in v_def) > 0 then
    raise exception 'record_till_cash_out: the installed body has CRLF line endings — the anchor below assumes LF';
  end if;
  v_was := v_def;

  if position($m$from public.payments where booked_session_id = p_session_id and method = 'cash';$m$ in v_def) = 0 then
    v_n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
    if v_n <> 1 then
      raise exception 'record_till_cash_out: the drawer-sum anchor matches % times, not 1 — the ceiling was NOT corrected', v_n;
    end if;
    v_def := replace(v_def, v_anchor, v_fix);
  end if;

  if v_def is distinct from v_was then
    execute v_def;
  end if;

  if (select p.proacl::text from pg_proc p where p.oid = v_oid) is distinct from v_acl then
    raise exception 'record_till_cash_out: the splice changed who may execute the function';
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
   where n.nspname = 'public' and p.proname = 'record_till_cash_out';
  if v_n <> 1 then raise exception 'record_till_cash_out has % definitions — a stale overload is live', v_n; end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_till_cash_out';

  if position($m$from public.payments where booked_session_id = p_session_id and method = 'cash';$m$ in v_def) = 0 then
    raise exception 'record_till_cash_out still does not sum the drawer by booked_session_id';
  end if;
  if position($m$from public.payments where cash_session_id = p_session_id$m$ in v_def) > 0 then
    raise exception 'record_till_cash_out still sums the drawer by cash_session_id';
  end if;
  -- Movements are keyed by the till they happened on; that line is right and stays.
  if position('from public.till_movements where cash_session_id = p_session_id;' in v_def) = 0
     or position('is in the drawer' in v_def) = 0
     or position('the till is not open' in v_def) = 0
     or position('a reason is required' in v_def) = 0
     or position('amount must be positive' in v_def) = 0 then
    raise exception 'record_till_cash_out lost one of its own guards while regaining its ceiling';
  end if;
end $$;
