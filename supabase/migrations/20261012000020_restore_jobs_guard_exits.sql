-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — the jobs guard gets its two exits back.
--
-- Found while establishing how reverse_payment lost its guards (20261012000010).
-- The installed app.jobs_guard is lifecycle_hardening's body of 14 July, line
-- for line. Its catalog row was last written by transaction 442211, some eighty
-- transactions before the tracked `db push` of the 2026-09-10 history repair
-- began (442288) — the same session, by every sign an earlier attempt of that
-- push made while the file still carried a 15-digit stamp; the tracker kept no
-- row for it, so that last step is inferred, not read. Two later files that
-- amended the guard had already been marked applied, so neither ran again:
--
--   20260716000030 — the `app.allow_undeliver` hatch. undo_on_account sets it so
--     the cashier who mis-tapped "put it on account" can walk the handover back.
--     Without the hatch the guard answers 'only owner or manager can un-deliver
--     a job' and the cashier's undo fails.
--   20260803000030 — ready → cancelled. Without it cancel_job, which accepts a
--     ready job, is stopped by its own trigger: 'illegal job transition: ready ->
--     cancelled'. That is the trap 20260803000030 was written to open — a job
--     marked ready by mistake, whose bill comes back under a new number after
--     every void.
--
-- Spliced onto the live body, the same way and for the same reason as
-- 20261012000010: marker first (so a second run is a no-op), then an anchor that
-- must match exactly once. The result is 20260803000030's body character for
-- character; scripts/_verify-jobs-guard-exits.mjs compares the two.
-- ═══════════════════════════════════════════════════════════════════════════

do $do$
declare
  v_oid oid;
  v_n   int;
  v_def text;
  v_was text;

  -- 20260803000030: ready may also be cancelled, and the comment that says why.
  v_why_anchor   text := $a$    if not ( (old.status = 'scheduled'   and new.status in ('in_progress','ready','cancelled'))$a$ || E'\n';
  v_why          text := $a$    -- 'ready' is work finished but NOT handed over — the car is still here, so the
    -- booking can still be called off. 'delivered' stays a one-way door: once the
    -- customer has driven away, the correction is a credit note, not a cancellation.
$a$;
  v_ready_anchor text := $a$          or (old.status = 'ready'       and new.status = 'delivered')$a$ || E'\n';
  v_ready_fix    text := $a$          or (old.status = 'ready'       and new.status in ('delivered','cancelled'))$a$ || E'\n';

  -- 20260716000030: the hatch only undo_on_account opens.
  v_hatch_anchor text := $a$    if old.status = 'delivered' and new.status = 'ready' and v_role not in ('owner','manager') then$a$ || E'\n';
  v_hatch_fix    text := $a$    if old.status = 'delivered' and new.status = 'ready' and v_role not in ('owner','manager')
       and coalesce(current_setting('app.allow_undeliver', true), '') <> '1' then
$a$;
begin
  v_why       := replace(v_why,       E'\r', '');
  v_hatch_fix := replace(v_hatch_fix, E'\r', '');

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'jobs_guard';
  if v_n <> 1 then
    raise exception 'app.jobs_guard has % definitions, not 1 — resolve them before splicing', v_n;
  end if;

  select p.oid, pg_get_functiondef(p.oid) into v_oid, v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'jobs_guard';
  if position(E'\r' in v_def) > 0 then
    raise exception 'app.jobs_guard: the installed body has CRLF line endings — the anchors below assume LF';
  end if;
  v_was := v_def;

  if position($m$new.status in ('delivered','cancelled')$m$ in v_def) = 0 then
    v_n := (length(v_def) - length(replace(v_def, v_ready_anchor, ''))) / length(v_ready_anchor);
    if v_n <> 1 then
      raise exception 'app.jobs_guard: the ready-transition anchor matches % times, not 1 — ready → cancelled was NOT restored', v_n;
    end if;
    v_def := replace(v_def, v_ready_anchor, v_ready_fix);
  end if;

  if position('is work finished but NOT handed over' in v_def) = 0 then
    v_n := (length(v_def) - length(replace(v_def, v_why_anchor, ''))) / length(v_why_anchor);
    if v_n <> 1 then
      raise exception 'app.jobs_guard: the transition-table anchor matches % times, not 1', v_n;
    end if;
    v_def := replace(v_def, v_why_anchor, v_why || v_why_anchor);
  end if;

  if position('app.allow_undeliver' in v_def) = 0 then
    v_n := (length(v_def) - length(replace(v_def, v_hatch_anchor, ''))) / length(v_hatch_anchor);
    if v_n <> 1 then
      raise exception 'app.jobs_guard: the un-deliver anchor matches % times, not 1 — the undo hatch was NOT restored', v_n;
    end if;
    v_def := replace(v_def, v_hatch_anchor, v_hatch_fix);
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
   where n.nspname = 'app' and p.proname = 'jobs_guard';
  if v_n <> 1 then raise exception 'app.jobs_guard has % definitions', v_n; end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'jobs_guard';

  if position($m$(old.status = 'ready'       and new.status in ('delivered','cancelled'))$m$ in v_def) = 0 then
    raise exception 'app.jobs_guard still refuses ready → cancelled';
  end if;
  if position($m$and coalesce(current_setting('app.allow_undeliver', true), '') <> '1' then$m$ in v_def) = 0 then
    raise exception 'app.jobs_guard still has no undo hatch';
  end if;
  -- Nothing it already enforced was loosened getting there.
  if position('job identity columns are immutable' in v_def) = 0
     or position('only owner, manager or cashier can mark a job delivered' in v_def) = 0
     or position('only owner or manager can cancel a job' in v_def) = 0
     or position('only owner or manager can un-deliver a job' in v_def) = 0
     or position($m$(old.status = 'delivered'   and new.status = 'ready')$m$ in v_def) = 0 then
    raise exception 'app.jobs_guard lost one of its own rules while regaining its exits';
  end if;
  if position($m$'delivered','cancelled','ready'$m$ in v_def) > 0
     or position($m$old.status = 'delivered'   and new.status in$m$ in v_def) > 0 then
    raise exception 'app.jobs_guard: delivered must stay a one-way door except back to ready';
  end if;

  -- The guard is only a guard while the trigger still calls it.
  if not exists (
    select 1 from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = p.pronamespace
     where t.tgrelid = 'public.jobs'::regclass and t.tgname = 'trg_jobs_guard'
       and t.tgenabled = 'O' and n.nspname = 'app' and p.proname = 'jobs_guard'
  ) then
    raise exception 'trg_jobs_guard is not calling app.jobs_guard';
  end if;
end $$;
