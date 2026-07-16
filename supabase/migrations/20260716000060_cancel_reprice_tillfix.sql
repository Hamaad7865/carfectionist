-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — the last three money-flow holes (flow audit round 2)
--
-- 1) record_till_cash_out summed the drawer by payments.cash_session_id while
--    every reconciliation (close_cash_session, pre_close_summary, z_totals)
--    sums by booked_session_id. A refund booked into this drawer from another
--    till's payment made the ceiling wrong in both directions: it could let a
--    cash-out exceed the physical drawer, or refuse one that fits.
-- 2) app.z_totals never mentioned till_movements: petty cash paid out of the
--    drawer had NO line on the printed Z. The drawer maths knew (close_cash_
--    session sums movements); the paper didn't. z_totals now carries a
--    'movements' block, so every frozen Z from here on shows PAID OUT.
-- 3) cancel_job: the DB has allowed scheduled|in_progress → cancelled since
--    lifecycle_hardening, but NO screen could reach it, and nothing said what
--    happens to the job's money. Now: cancelling resolves the bill in the same
--    transaction — a draft is deleted, an unpaid bill is voided, a bill with
--    money on it gets a credit note whose refund is BOOKED to the till
--    (20260716000050). The quote is left as the audit trail.
-- 4) convert_quote_to_job's revision branch raised 'issue a credit note rather
--    than re-pricing' the moment the job had a live invoice — but a credit note
--    never unblocked it (the RPC only checks status <> 'void'), so a job with a
--    deposit could NEVER be re-priced, and no mechanism carried the deposit
--    anywhere. Now accepting a revision against a billed job re-prices for
--    real: the deposit is transferred ledger-style (paired ± rows, booked to no
--    session — no drawer or Z impact, the money already counted on its own
--    day), the old bill is voided as 're-priced', the revised quote is billed
--    and issued, and the deposit lands on the new bill.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) record_till_cash_out — ceiling on the same axis as every reconciliation --
create or replace function public.record_till_cash_out(p_session_id uuid, p_amount numeric, p_reason text, p_idempotency_key text default null::text)
returns till_movements language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_sess   public.cash_sessions;
  v_cash   numeric;
  v_moves  numeric;
  v_row    public.till_movements;
  v_existing uuid;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'a reason is required'; end if;

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || p_idempotency_key)::bigint);
    select (result->>'till_movement_id')::uuid into v_existing
      from public.idempotency_keys where tenant_id = v_tenant and key = p_idempotency_key;
    if v_existing is not null then
      select * into v_row from public.till_movements where id = v_existing; return v_row;
    end if;
  end if;

  select * into v_sess from public.cash_sessions
   where id = p_session_id and tenant_id = v_tenant for update;
  if not found then raise exception 'cash session not found'; end if;
  if v_sess.status <> 'open' then raise exception 'the till is not open'; end if;

  -- Never take out more than the drawer holds: float + cash payments + prior movements.
  -- BOOKED to this drawer — the axis close_cash_session and the Z reconcile on. The old
  -- cash_session_id sum missed refunds booked in from elsewhere and counted payments
  -- whose money was booked out.
  select coalesce(sum(amount),0) into v_cash
    from public.payments where booked_session_id = p_session_id and method = 'cash';
  select coalesce(sum(amount),0) into v_moves
    from public.till_movements where cash_session_id = p_session_id;
  if p_amount > v_sess.opening_float + v_cash + v_moves then
    raise exception 'only % is in the drawer', v_sess.opening_float + v_cash + v_moves;
  end if;

  insert into public.till_movements (tenant_id, cash_session_id, amount, reason, created_by)
  values (v_tenant, p_session_id, -p_amount, trim(p_reason), v_actor)
  returning * into v_row;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload, device_id)
  values (v_tenant, v_actor, 'till_cash_out', 'till_movement', v_row.id,
          jsonb_build_object('amount', p_amount, 'reason', trim(p_reason), 'session_id', p_session_id),
          v_sess.device_id);

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (tenant_id, key, rpc, result)
    values (v_tenant, p_idempotency_key, 'record_till_cash_out', jsonb_build_object('till_movement_id', v_row.id))
    on conflict (tenant_id, key) do nothing;
  end if;

  return v_row;
end $function$;

-- 2) z_totals — petty cash paid out gets its line on the Z ---------------------
-- Byte-identical to the live function except the movements block.
create or replace function app.z_totals(p_tenant uuid, p_session uuid, p_day uuid, p_as_at timestamp with time zone)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_date        date;
  v_docs        uuid[];
  v_pays        uuid[];
  v_tickets     int;
  v_on_account  int;
  v_total_incl  numeric := 0;
  v_credit      numeric := 0;
  v_methods     jsonb;
  v_categories  jsonb;
  v_vat         jsonb;
  v_cashiers    jsonb;
  v_movements   jsonb;
  v_reversals   int;
  v_voided      int;
  v_out         jsonb;
begin
  if (p_session is null) = (p_day is null) then
    raise exception 'z_totals takes a service or a day, not both';
  end if;

  if p_day is not null then
    select business_date into v_date from public.trading_days where id = p_day and tenant_id = p_tenant;
  end if;

  select coalesce(array_agg(d.id), '{}')
    into v_docs
    from public.documents d
   where d.tenant_id = p_tenant
     and d.doc_type = 'invoice'
     and d.status <> 'void'
     and d.issued_at is not null
     and d.issued_at <= p_as_at
     and ( (p_session is not null and d.cash_session_id = p_session)
        or (p_day     is not null and d.business_day = v_date) );

  select coalesce(array_agg(pm.id), '{}')
    into v_pays
    from public.payments pm
   where pm.tenant_id = p_tenant
     and pm.received_at <= p_as_at
     and ( (p_session is not null and pm.booked_session_id = p_session)
        or (p_day is not null and pm.booked_session_id in (
              select s.id from public.cash_sessions s where s.trading_day_id = p_day)) );

  select count(*), coalesce(sum(d.total_incl), 0)
    into v_tickets, v_total_incl
    from public.documents d where d.id = any(v_docs);

  select coalesce(sum(greatest(d.total_incl - coalesce(paid.amt, 0), 0)), 0),
         count(*) filter (where d.total_incl - coalesce(paid.amt, 0) > 0.004)
    into v_credit, v_on_account
    from public.documents d
    left join lateral (
      select sum(p2.amount) as amt from public.payments p2
       where p2.document_id = d.id and p2.received_at <= p_as_at
    ) paid on true
   where d.id = any(v_docs);

  select coalesce(jsonb_agg(m order by m->>'method'), '[]'::jsonb) into v_methods
  from (
    select jsonb_build_object(
             'method', pm.method::text,
             'count',  sum(sign(pm.amount))::int,
             'gross',  round(sum(coalesce(pm.tendered, pm.amount)), 2),
             'change', round(sum(coalesce(pm.change_given, 0)), 2),
             'net',    round(sum(pm.amount), 2)
           ) as m
      from public.payments pm
     where pm.id = any(v_pays)
     group by pm.method
  ) x;

  select coalesce(jsonb_agg(c order by c->>'name'), '[]'::jsonb) into v_categories
  from (
    select jsonb_build_object(
             'name',  coalesce(nullif(trim(p.category), ''), '(uncategorised)'),
             'lines', count(*)::int,
             'incl',  round(sum((dl.line_total_excl + dl.line_vat) * f.factor), 2)
           ) as c
      from public.document_lines dl
      join public.documents d on d.id = dl.document_id
      left join public.products p on p.id = dl.product_id
      join lateral (
        select case when sum(dl2.line_total_excl + dl2.line_vat) > 0
                    then d.total_incl / sum(dl2.line_total_excl + dl2.line_vat) else 1 end as factor
          from public.document_lines dl2 where dl2.document_id = d.id
      ) f on true
     where d.id = any(v_docs)
     group by coalesce(nullif(trim(p.category), ''), '(uncategorised)')
  ) y;

  select coalesce(jsonb_agg(v order by (v->>'rate')::numeric desc), '[]'::jsonb) into v_vat
  from (
    select jsonb_build_object(
             'rate',  rate,
             'label', case when rate = 0 then 'EXONERE 0.00%'
                           when rate = 15 then 'TAUX NORMAL 15.00%'
                           else 'TAUX ' || to_char(rate, 'FM990.00') || '%' end,
             'excl',  round(sum(base), 2),
             'vat',   round(sum(vat), 2),
             'incl',  round(sum(base) + sum(vat), 2)
           ) as v
      from (
        select (g->>'rate')::numeric as rate, (g->>'base')::numeric as base, (g->>'vat')::numeric as vat
          from public.documents d, jsonb_array_elements(d.vat_breakdown) g
         where d.id = any(v_docs)
      ) parts
     group by rate
  ) z;

  -- ── Who took the money. The owner's "User as cashier" section is what each cashier
  -- COLLECTED, split by means of payment, and the total is the sum of that split (his
  -- ANSHIKA 4283 = BANK CARD 3568 + Cash 715). So the section is built from the payments
  -- each cashier received (payments.received_by), grouped by method — total = Σ methods.
  select coalesce(jsonb_agg(c order by c->>'name'), '[]'::jsonb) into v_cashiers
  from (
    select jsonb_build_object(
             'name',  coalesce(u.display_name, '—'),
             'total', round(sum(pm.amount), 2),
             'methods', coalesce((
               select jsonb_agg(jsonb_build_object('method', mm.method, 'amount', mm.amt) order by mm.amt desc)
                 from (
                   select pm2.method::text as method, round(sum(pm2.amount), 2) as amt
                     from public.payments pm2
                    where pm2.id = any(v_pays)
                      and pm2.received_by is not distinct from pm.received_by
                    group by pm2.method
                 ) mm
             ), '[]'::jsonb)
           ) as c
      from public.payments pm
      left join public.app_users u on u.id = pm.received_by
     where pm.id = any(v_pays)
     group by pm.received_by, u.display_name
  ) w;

  -- ── Petty cash paid out of the drawer (till movements are negative amounts).
  -- The drawer maths always counted these; now the paper does too.
  select jsonb_build_object('count', count(*), 'total', round(coalesce(sum(tm.amount), 0), 2))
    into v_movements
    from public.till_movements tm
   where tm.tenant_id = p_tenant
     and tm.created_at <= p_as_at
     and ( (p_session is not null and tm.cash_session_id = p_session)
        or (p_day is not null and tm.cash_session_id in (
              select s.id from public.cash_sessions s where s.trading_day_id = p_day)) );

  select count(*) filter (where pm.reverses_payment_id is not null)
    into v_reversals
    from public.payments pm where pm.id = any(v_pays);

  select count(*) into v_voided
    from public.documents d
   where d.tenant_id = p_tenant and d.doc_type = 'invoice' and d.status = 'void'
     and ( (p_session is not null and d.cash_session_id = p_session)
        or (p_day is not null and d.business_day = v_date) );

  v_out := jsonb_build_object(
    'tickets',      v_tickets,
    'on_account',   v_on_account,
    'total_incl',   round(v_total_incl, 2),
    'avg_basket',   case when (v_tickets - v_on_account) > 0
                         then round(v_total_incl / (v_tickets - v_on_account), 2) else 0 end,
    'avg_basket_all', case when v_tickets > 0 then round(v_total_incl / v_tickets, 2) else 0 end,
    'customer_credit', jsonb_build_object('count', v_on_account, 'amount', round(v_credit, 2)),
    'methods',      v_methods,
    'categories',   v_categories,
    'vat',          v_vat,
    'cashiers',     v_cashiers,
    'movements',    v_movements,
    'reversals',    v_reversals,
    'voided_bills', v_voided,
    'as_at',        p_as_at
  );
  return v_out;
end $function$;

-- 3) cancel_job — cancelling resolves the money in the same transaction --------
create or replace function public.cancel_job(
  p_job_id uuid,
  p_reason text,
  p_restock boolean default true,
  p_session_id uuid default null -- the till a booked refund comes out of (credit-note path)
) returns jobs language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_job    public.jobs;
  v_inv    public.documents;
  v_money  text := 'no invoice';
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  -- Same gate as app.jobs_guard's cancelled transition.
  perform app.require_role('owner','manager');
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'a reason is required to cancel a job';
  end if;

  select * into v_job from public.jobs
   where id = p_job_id and tenant_id = v_tenant for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status = 'cancelled' then return v_job; end if; -- double tap: no-op
  if v_job.status not in ('scheduled','in_progress') then
    raise exception 'a % job cannot be cancelled — finish or deliver it instead', v_job.status;
  end if;

  -- The job's one live invoice, resolved so no bill is left pointing at dead work:
  -- a draft simply goes; an unpaid bill is voided; money already taken comes back
  -- as a credit note whose refund is BOOKED to the till (20260716000050).
  select * into v_inv from public.documents
   where tenant_id = v_tenant and job_id = p_job_id
     and doc_type = 'invoice' and status <> 'void'
   for update;
  if found then
    if v_inv.status = 'draft' then
      delete from public.document_lines where document_id = v_inv.id;
      delete from public.documents where id = v_inv.id;
      v_money := 'draft deleted';
    elsif v_inv.amount_paid = 0 then
      perform public.void_document(v_inv.id, 'Job cancelled — ' || trim(p_reason));
      v_money := 'bill ' || coalesce(v_inv.number, '?') || ' voided';
    else
      perform public.create_and_issue_credit_note(v_inv.id, null, p_restock, p_session_id);
      v_money := 'bill ' || coalesce(v_inv.number, '?') || ' credit-noted, ' || v_inv.amount_paid || ' refunded';
    end if;
  end if;

  update public.jobs set status = 'cancelled' where id = p_job_id returning * into v_job;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'job_cancelled', 'job', p_job_id,
          jsonb_build_object('reason', trim(p_reason), 'money', v_money,
                             'quote', (select number from public.documents where id = v_job.source_quote_id)));
  return v_job;
end $function$;

grant execute on function public.cancel_job(uuid, text, boolean, uuid) to authenticated;

-- 4) convert_quote_to_job — accepting a revision RE-PRICES a billed job --------
-- Byte-identical to the live function except the revision branch's dead end.
create or replace function public.convert_quote_to_job(p_quote_id uuid, p_technician_id uuid, p_scheduled_at timestamp with time zone default null::timestamp with time zone, p_signature jsonb default null::jsonb)
returns jobs language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_actor   uuid := app.current_app_user_id();
  v_q       public.documents;
  v_job     public.jobs;
  v_service text;
  v_sig     jsonb := case when p_signature is null then null
                          else p_signature || jsonb_build_object('at', now()) end;
  r         jsonb;
  v_old     public.documents;
  v_new_inv public.documents;
  v_pay     public.payments;
  v_carried numeric := 0;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents
   where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'source document is not a quote'; end if;

  -- Idempotent: already converted — hand back the same job, but back-fill the
  -- signature if the first accept's response was lost before the client saw it.
  select * into v_job from public.jobs
   where source_quote_id = v_q.id and tenant_id = v_tenant;
  if found then
    if v_sig is not null and v_q.accepted_signature is null then
      update public.documents set accepted_signature = v_sig where id = v_q.id;
    end if;
    return v_job;
  end if;

  if v_q.customer_id is null then raise exception 'this quote has no customer — add one before starting a job'; end if;
  if v_q.vehicle_id  is null then raise exception 'this quote has no vehicle — add one before starting a job'; end if;
  if p_technician_id is not null and not exists (
    select 1 from public.app_users where id = p_technician_id and tenant_id = v_tenant
  ) then raise exception 'unknown technician'; end if;

  if v_q.status = 'draft' then
    select * into v_q from public.issue_document(v_q.id, null, 'quote-accept:' || v_q.id);
  elsif v_q.status <> 'issued' then
    raise exception 'this quote is % and cannot be converted to a job', v_q.status;
  end if;

  select title into v_service from public.document_lines
   where document_id = v_q.id order by sort_order limit 1;

  -- A REVISION of a quote whose job is still alive. Same car, same job — only the agreed
  -- price moved, so accept it against the card already on the board. A CANCELLED job is
  -- not eligible: jobs_guard has no way out of 'cancelled', so re-pricing one would bury
  -- the work where no screen can reach it. Those fall through and open a fresh job.
  if v_q.source_document_id is not null and v_q.job_id is not null then
    select * into v_job from public.jobs
     where id = v_q.job_id and tenant_id = v_tenant and status <> 'cancelled';
    if found then
      -- An invoice raised from a quote BEFORE it had a job carries job_id NULL, which hid
      -- it from the guard below and let a second live invoice through. Claim it first.
      update public.documents
         set job_id = v_job.id
       where tenant_id = v_tenant and doc_type = 'invoice'
         and status <> 'void' and job_id is null
         and source_document_id in (
           select id from public.documents
            where tenant_id = v_tenant and doc_type = 'quote'
              and (id = v_q.id or id = v_q.source_document_id)
         );

      update public.jobs
         set notes         = coalesce(nullif(btrim(v_service), ''), notes),
             technician_id = coalesce(p_technician_id, technician_id),
             scheduled_at  = coalesce(p_scheduled_at, scheduled_at)
       where id = v_job.id
       returning * into v_job;

      -- Accept the revision BEFORE re-billing: convert_quote_to_invoice bills the
      -- last ACCEPTED quote, which must be this one.
      update public.documents
         set status = 'accepted', job_id = v_job.id,
             accepted_signature = coalesce(v_sig, accepted_signature)
       where id = v_q.id;

      -- The job is already billed? Then this accept IS a re-price: retire the old
      -- bill, carry any deposit forward, and bill the revision — one transaction.
      select * into v_old from public.documents
       where tenant_id = v_tenant and job_id = v_job.id
         and doc_type = 'invoice' and status <> 'void'
       for update;
      if found and v_old.source_document_id is distinct from v_q.id then
        if v_old.status = 'draft' then
          -- Never issued: no number, no money — it simply goes.
          delete from public.document_lines where document_id = v_old.id;
          delete from public.documents where id = v_old.id;
        else
          -- Transfer the deposit OFF the old bill: paired ledger rows booked to no
          -- session — no drawer or Z impact, the money already counted on the day
          -- it was taken. The OUT mirror marks each payment reversed, so the old
          -- bill recomputes to unpaid and nothing can double-collect it.
          for v_pay in
            select * from public.payments p
             where p.tenant_id = v_tenant and p.document_id = v_old.id
               and p.amount > 0 and p.reverses_payment_id is null
               and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
          loop
            insert into public.payments
              (tenant_id, document_id, method, amount, external_ref, reverses_payment_id,
               cash_session_id, booked_session_id, received_by)
            values
              (v_tenant, v_old.id, v_pay.method, -v_pay.amount,
               'moved to revised bill', v_pay.id, v_pay.cash_session_id, null, v_actor);
            v_carried := v_carried + v_pay.amount;
          end loop;
          update public.documents
             set amount_paid = 0,
                 status = 'issued'::doc_status
           where id = v_old.id;

          -- Void the now-unpaid old bill (inline: this path is open to the cashier
          -- who takes the signature, unlike owner/manager-only void_document) and
          -- put its stocked items back — the revision's issue will draw them again.
          insert into public.stock_movements
            (tenant_id, product_id, location_id, qty, unit_cost, ref_type, ref_id, ref_line_id, created_by, note)
          select tenant_id, product_id, location_id, -qty, unit_cost, 'invoice', ref_id, null, v_actor, 'void reversal (re-priced)'
          from public.stock_movements
          where tenant_id = v_tenant and ref_type = 'invoice' and ref_id = v_old.id and ref_line_id is not null;
          update public.documents
             set status = 'void', voided_at = now(),
                 void_reason = 'Re-priced — replaced by revision ' || coalesce(v_q.number, '')
           where id = v_old.id;
          insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
          values (v_tenant, v_actor, 'document_voided', 'document', v_old.id,
                  jsonb_build_object('reason', 're-priced by revision ' || coalesce(v_q.number, ''),
                                     'replaced_by_quote', v_q.id));
        end if;

        -- Bill the revision NOW and land the deposit on it, so checkout shows the
        -- honest balance the moment the customer signs.
        select * into v_new_inv from public.convert_quote_to_invoice(v_q.id);
        if v_new_inv.status = 'draft' then
          select * into v_new_inv from public.issue_document(v_new_inv.id, null, 'reprice:' || v_q.id, null);
        end if;
        if v_carried > 0 then
          -- A standing positive cash row must satisfy the tender arithmetic check;
          -- a transfer changes no hands, so tendered = amount, change 0.
          insert into public.payments
            (tenant_id, document_id, method, amount, tendered, change_given, external_ref,
             reverses_payment_id, cash_session_id, booked_session_id, received_by)
          select v_tenant, v_new_inv.id, p.method, p.amount,
                 case when p.method = 'cash' then p.amount end,
                 case when p.method = 'cash' then 0::numeric end,
                 'deposit from ' || coalesce(v_old.number, 'previous bill'),
                 null, p.cash_session_id, null, p.received_by
            from public.payments p
           where p.tenant_id = v_tenant and p.document_id = v_old.id
             and p.amount > 0 and p.reverses_payment_id is null;
          update public.documents d
             set amount_paid = sub.paid,
                 status = (case when sub.paid >= d.total_incl then 'paid' else 'partly_paid' end)::doc_status
            from (select coalesce(sum(amount),0) paid from public.payments where document_id = v_new_inv.id) sub
           where d.id = v_new_inv.id;
        end if;
      end if;

      insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
      values (v_tenant, v_actor, 'quote_revision_accepted', 'document', v_q.id,
              jsonb_build_object('job_id', v_job.id, 'quote_number', v_q.number,
                                 'replaces', v_q.source_document_id, 'signed', v_sig is not null,
                                 'rebilled', v_new_inv.number, 'deposit_carried', v_carried));

      return v_job;
    end if;
  end if;

  insert into public.jobs
    (tenant_id, customer_id, vehicle_id, technician_id, scheduled_at, notes,
     status, checklist, damage_markers, source_quote_id, created_by)
  values
    (v_tenant, v_q.customer_id, v_q.vehicle_id, p_technician_id, p_scheduled_at,
     coalesce(nullif(btrim(v_service), ''), 'From quote ' || v_q.number), 'scheduled',
     '[{"label":"Intake photos & damage check","done":false},{"label":"Wash & prep","done":false},{"label":"Service work","done":false},{"label":"Final inspection","done":false}]'::jsonb,
     coalesce(v_q.intake->'markers', '[]'::jsonb),
     v_q.id, v_actor)
  returning * into v_job;

  -- Same claim for a first accept: the builder's "Bill now" can have raised an invoice
  -- from this quote before any job existed.
  update public.documents
     set job_id = v_job.id
   where tenant_id = v_tenant and doc_type = 'invoice'
     and status <> 'void' and job_id is null
     and source_document_id = v_q.id;

  for r in select value from jsonb_array_elements(coalesce(v_q.intake->'photos', '[]'::jsonb)) loop
    if nullif(r->>'path', '') is not null then
      insert into public.job_photos (tenant_id, job_id, storage_path, caption, phase, created_by)
      values (v_tenant, v_job.id, r->>'path', nullif(r->>'caption', ''), 'before', v_actor);
    end if;
  end loop;

  update public.documents
     set status = 'accepted', job_id = v_job.id,
         accepted_signature = coalesce(v_sig, accepted_signature)
   where id = v_q.id;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'quote_converted_to_job', 'document', v_q.id,
          jsonb_build_object('job_id', v_job.id, 'quote_number', v_q.number,
                             'signed', v_sig is not null));

  return v_job;
end $function$;
