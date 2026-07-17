-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — close_period: attribute takings to the drawer they MOVED
--
-- takings_by_device joined cash_sessions on p.cash_session_id — the till that
-- took the ORIGINAL money. Since till_integrity (20260714000003) a reversal is
-- booked on the till the refund is paid OUT of (booked_session_id), and every
-- drawer computation (close_cash_session, the web's live expected) follows that
-- column. The monthly snapshot was the straggler: a refund processed on till B
-- for money till A took was still deducted from A's device in the month close.
--
-- coalesce(booked, cash): both are equal for every normal payment; booked is
-- null only for a non-cash refund done with no open till, where falling back to
-- the taking till at least keeps the row attributed instead of 'unattributed'.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.close_period(p_period text)
 RETURNS period_closes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_start  timestamptz;
  v_end    timestamptz;
  v_totals jsonb;
  v_row    public.period_closes;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner');
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'period must be YYYY-MM'; end if;

  -- Month bounds as MU-local midnights (Mauritius is UTC+04, no DST).
  v_start := (p_period || '-01 00:00:00+04')::timestamptz;
  v_end   := v_start + interval '1 month';
  if v_end > now() then raise exception 'period % has not finished yet', p_period; end if;

  select jsonb_build_object(
    'invoices', (
      select jsonb_build_object('count', count(*), 'revenue', coalesce(sum(total_incl),0), 'vat', coalesce(sum(vat_total),0))
      from public.documents
      where tenant_id = v_tenant and doc_type = 'invoice' and status <> 'void'
        and issued_at >= v_start and issued_at < v_end
    ),
    'credit_notes', (
      select jsonb_build_object('count', count(*), 'amount', coalesce(sum(total_incl),0))
      from public.documents
      where tenant_id = v_tenant and doc_type = 'credit_note' and status <> 'void'
        and issued_at >= v_start and issued_at < v_end
    ),
    'payments_by_method', (
      select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb)
      from (select method::text, sum(amount) amt
            from public.payments
            where tenant_id = v_tenant and received_at >= v_start and received_at < v_end
            group by method) m
    ),
    'takings_by_device', (
      select coalesce(jsonb_object_agg(dev, amt), '{}'::jsonb)
      from (select coalesce(cs.device_id, 'unattributed') dev, sum(p.amount) amt
            from public.payments p
            left join public.cash_sessions cs on cs.id = coalesce(p.booked_session_id, p.cash_session_id)
            where p.tenant_id = v_tenant and p.received_at >= v_start and p.received_at < v_end
            group by 1) d
    )
  ) into v_totals;

  insert into public.period_closes (tenant_id, period, closed_by, totals)
  values (v_tenant, p_period, v_actor, v_totals)
  returning * into v_row;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'period_closed', 'period_close', v_row.id,
          jsonb_build_object('period', p_period, 'totals', v_totals));

  return v_row;
exception when unique_violation then
  raise exception 'period % is already closed', p_period;
end $function$;
