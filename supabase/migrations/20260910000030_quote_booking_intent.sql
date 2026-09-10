-- Booking intent lives on the quote.
--
-- The tablet's accept panel collects a date/time and a deposit %, but
-- accept-for-later saved neither: reopening a quote resets both to empty and
-- "Create job →" raised a bare job (JOB-a73c: scheduled, no time, no deposit
-- guidance). The intent is not fiscal — no numbers minted, no money moved —
-- so it is two plain columns, written by set_quote_booking on issued or
-- accepted quotes and read back by both apps. Old quotes read null: nothing
-- was agreed, and nothing changes for them.
alter table public.documents
  add column if not exists book_for_at timestamptz,
  add column if not exists deposit_due numeric(12,2);

comment on column public.documents.book_for_at is
  'Quotes only: when the customer will bring the car in, as picked at accept. Carried onto the job at "Create job".';
comment on column public.documents.deposit_due is
  'Quotes only: rupees the customer agreed to leave as a deposit, as picked at accept. Raised as the bill at "Create job".';

create or replace function public.set_quote_booking(p_quote_id uuid, p_book_for_at timestamptz, p_deposit_rupees numeric)
returns public.documents
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_q      public.documents;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');

  select * into v_q from public.documents
   where id = p_quote_id and tenant_id = v_tenant for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.doc_type <> 'quote' then raise exception 'only quotes carry a booking'; end if;
  if v_q.status not in ('issued', 'accepted') then
    raise exception 'a % quote cannot be booked', v_q.status;
  end if;

  if p_deposit_rupees is not null then
    if p_deposit_rupees < 0 then raise exception 'a deposit cannot be negative'; end if;
    if p_deposit_rupees > coalesce(v_q.total_incl, 0) then
      raise exception 'a deposit cannot exceed the quoted total of Rs %',
        trim(to_char(coalesce(v_q.total_incl, 0), 'FM999G999G990D00'));
    end if;
  end if;

  update public.documents
     set book_for_at = p_book_for_at,
         deposit_due = case when p_deposit_rupees is null then null else round(p_deposit_rupees, 2) end
   where id = v_q.id
  returning * into v_q;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_tenant, v_actor, 'quote_booking_set', 'document', v_q.id,
          jsonb_build_object('book_for_at', p_book_for_at, 'deposit_due', v_q.deposit_due));

  return v_q;
end $function$;

comment on function public.set_quote_booking(uuid, timestamptz, numeric) is
  'Stores when the customer will come in and what deposit they agreed, on an issued/accepted quote. Intent only: honoured by "Create job", never fiscal.';

revoke execute on function public.set_quote_booking(uuid, timestamptz, numeric) from public;
revoke execute on function public.set_quote_booking(uuid, timestamptz, numeric) from anon;
grant execute on function public.set_quote_booking(uuid, timestamptz, numeric) to authenticated;
