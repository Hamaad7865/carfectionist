-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — collecting a car ON ACCOUNT is still a handover
--
-- A READY job's invoice can be taken "on account" (credit): the customer drives
-- off now and the invoice stays outstanding as a receivable on their statement.
-- record_payment only delivers a job when the bill is settled IN FULL, and a
-- credit collect records NO payment — so the job used to stay stuck at 'ready'
-- even though the car had already left.
--
-- This RPC closes that gap. It moves a READY job to 'delivered' WITHOUT touching
-- the invoice or recording a payment — an exact mirror of record_payment's
-- auto-deliver block (same role gate, same 'ready'→'delivered' move, same audit
-- crumb, just tagged "taken on account"). The invoice is left open on purpose, so
-- it still shows in checkout's TO COLLECT and on the customer's statement until
-- they pay.
--
-- Idempotent: only a 'ready' job moves, so a repeat tap is a no-op. An invoice
-- with no job (a walk-in on-account sale) validates and returns false — there is
-- nothing to hand over.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.deliver_on_account(p_invoice_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_doc    public.documents;
  v_moved  boolean := false;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  -- The same gate the jobs guard enforces for a delivery.
  perform app.require_role('owner','manager','cashier');

  select * into v_doc from public.documents
   where id = p_invoice_id and tenant_id = v_tenant for update;
  if not found then raise exception 'invoice not found'; end if;
  if v_doc.doc_type <> 'invoice' then raise exception 'on-account applies to invoices only'; end if;
  if v_doc.status not in ('issued','partly_paid') then
    raise exception 'invoice is not open for collection (status %)', v_doc.status;
  end if;
  -- Credit needs someone to owe the money — never a walk-in.
  if v_doc.customer_id is null then
    raise exception 'an on-account collect needs a customer';
  end if;

  -- Collection is the handover: the car left on account, so a READY job delivers.
  -- The invoice is deliberately left outstanding (this records NO payment).
  if v_doc.job_id is not null then
    update public.jobs
       set status = 'delivered', delivered_at = now()
     where id = v_doc.job_id and tenant_id = v_tenant and status = 'ready';
    if found then
      v_moved := true;
      insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
      values (v_tenant, v_actor, 'job_delivered', 'job', v_doc.job_id,
              jsonb_build_object('invoice', v_doc.number, 'via', 'taken on account'));
    end if;
  end if;

  return v_moved;
end $function$;

grant execute on function public.deliver_on_account(uuid) to authenticated;
