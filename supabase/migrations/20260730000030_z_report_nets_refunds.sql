-- ═══════════════════════════════════════════════════════════════════════════
-- Make the Z-report foot against itself when there has been a refund.
--
-- z_totals scoped documents to doc_type = 'invoice'. Payments were never filtered
-- that way, so a credit note's negative payment mirrors already pulled the drawer
-- and the means-of-payment split down — while "Total incl. tax", the category
-- breakdown and the VAT groups carried on as if the refund had not happened. Print
-- a Z on a day you refunded and the slip contradicts itself, and disagrees with the
-- Sales Journal for the same day, which nets credit notes properly.
--
-- Netted here on exactly the Sales Journal's terms so the two can never drift:
--   • money (total, categories, VAT groups) takes a -1 for a credit note;
--   • counts (tickets, category lines) stay invoice-only — a refund is not a sale;
--   • customer credit and on-account stay invoice-only — nobody OWES a refund;
--   • voided_bills stays invoice-only, as before.
-- `refunds` is added to the payload so the slip can say why the total is down
-- rather than leaving the reader to work it out.
--
-- Body is the LIVE function verbatim (as at 2026-07-29) with those changes only.
-- Requires 20260730000020, which stamps a credit note with the till and day this
-- function scopes on.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION app.z_totals(p_tenant uuid, p_session uuid, p_day uuid, p_as_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_date        date;
  v_docs        uuid[];
  v_cn_docs     uuid[];   -- credit notes in scope: they net the money, they are not tickets
  v_refunded    numeric := 0;
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

  -- Refunds in the same scope, kept in their own array. They NET the money down but
  -- are not sales: a refund is not a ticket, is not owed by anyone, and must not
  -- inflate the ticket count or the customer-credit figure. Same rule the Sales
  -- Journal applies (features -> sales-journal: sign = credit_note ? -1 : 1, and
  -- tickets counted for invoices only), so the two documents agree.
  select coalesce(array_agg(d.id), '{}')
    into v_cn_docs
    from public.documents d
   where d.tenant_id = p_tenant
     and d.doc_type = 'credit_note'
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

  -- A credit note stores POSITIVE amounts (it copies the invoice's lines); the sign is
  -- applied when reading, which is what the Sales Journal does too.
  select coalesce(sum(d.total_incl), 0) into v_refunded
    from public.documents d where d.id = any(v_cn_docs);
  v_total_incl := v_total_incl - v_refunded;

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
             -- Lines counts SOLD lines only, for the same reason tickets does.
             'lines', count(*) filter (where d.doc_type = 'invoice')::int,
             'incl',  round(sum((dl.line_total_excl + dl.line_vat) * f.factor
                                * case when d.doc_type = 'credit_note' then -1 else 1 end), 2)
           ) as c
      from public.document_lines dl
      join public.documents d on d.id = dl.document_id
      left join public.products p on p.id = dl.product_id
      join lateral (
        select case when sum(dl2.line_total_excl + dl2.line_vat) > 0
                    then d.total_incl / sum(dl2.line_total_excl + dl2.line_vat) else 1 end as factor
          from public.document_lines dl2 where dl2.document_id = d.id
      ) f on true
     where d.id = any(v_docs) or d.id = any(v_cn_docs)
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
        select (g->>'rate')::numeric as rate,
               (g->>'base')::numeric * case when d.doc_type = 'credit_note' then -1 else 1 end as base,
               (g->>'vat')::numeric  * case when d.doc_type = 'credit_note' then -1 else 1 end as vat
          from public.documents d, jsonb_array_elements(d.vat_breakdown) g
         where d.id = any(v_docs) or d.id = any(v_cn_docs)
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
    'refunds',      jsonb_build_object('count', coalesce(array_length(v_cn_docs, 1), 0),
                                       'amount', round(v_refunded, 2)),
    'as_at',        p_as_at
  );
  return v_out;
end $function$

