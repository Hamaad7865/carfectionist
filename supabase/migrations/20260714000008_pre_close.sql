-- ═══════════════════════════════════════════════════════════════════════════
-- "CHECK YOUR CASH REGISTER BEFORE CLOSING" — what the operator sees before they
-- validate: for every method, what this service took, and what has accumulated and
-- not yet gone to the bank. Ticking a method banks the whole accumulation.
--
-- Computed on the server so the screen, the close and the report can never disagree.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.pre_close_summary(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_sess   public.cash_sessions;
  v_rows   jsonb;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_sess from public.cash_sessions where id = p_session_id and tenant_id = v_tenant;
  if not found then raise exception 'till not found'; end if;

  select coalesce(jsonb_agg(r order by r->>'method'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
             'method',       m.method,
             -- what this service took in that method (a refund nets itself out)
             'takings',      coalesce((
                 select round(sum(pm.amount), 2) from public.payments pm
                  where pm.booked_session_id = p_session_id and pm.method::text = m.method), 0),
             -- what has piled up unbanked on THIS DEVICE (cash starts from the drawer float)
             'accumulation', coalesce((
                 select csm.float_out
                   from public.cash_session_methods csm
                   join public.cash_sessions s2 on s2.id = csm.cash_session_id
                  where s2.device_id = v_sess.device_id and s2.tenant_id = v_tenant
                    and s2.status = 'closed' and csm.method = m.method
                  order by s2.closed_at desc limit 1),
                 case when m.method = 'cash' then v_sess.opening_float else 0 end)
           ) as r
      from (
        select unnest(array['cash','card','juice','bank_transfer']) as method
      ) m
  ) x;

  return jsonb_build_object(
    'session_id',   p_session_id,
    'device',       v_sess.device_id,
    'service_no',   v_sess.service_no,
    'opening_float', v_sess.opening_float,
    -- what the drawer SHOULD hold: float + cash taken + cash paid out (petty cash)
    'expected_cash', v_sess.opening_float
                     + coalesce((select sum(pm.amount) from public.payments pm
                                  where pm.booked_session_id = p_session_id and pm.method = 'cash'), 0)
                     + coalesce((select sum(tm.amount) from public.till_movements tm
                                  where tm.cash_session_id = p_session_id), 0),
    'methods',      v_rows
  );
end $function$;
