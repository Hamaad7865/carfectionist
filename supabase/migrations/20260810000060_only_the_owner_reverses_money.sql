-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — money leaves the business on the owner's say-so.
--
-- Rule 3 of 2026-08-10. reverse_payment and create_and_issue_credit_note are
-- the two paths that put cash back in a customer's hand; both were open to a
-- manager. Narrowing only reverse_payment would have left the back door wide
-- open — a manager could refund the same money by crediting the invoice.
--
-- Everything else that undoes something (void_quote, void_certificate,
-- cancel_job, reopening a closed day) stays at owner|manager on purpose: a
-- manager still has to be able to run the shop without telephoning the owner
-- over a mistyped quote.
--
-- Both functions already demanded a reason. That stays; the override carries
-- its own reason besides.
--
-- Spliced, not retyped — reverse_payment alone has been rebuilt by seven
-- migrations, and the live body is the only trustworthy source.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.require_owner_or_override(p_ref_type text, p_ref_id uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_over   public.owner_overrides;
begin
  if app.current_user_role() = 'owner' then return; end if;

  select * into v_over from public.owner_overrides
   where tenant_id = v_tenant and kind = 'reversal'
     and ref_type = p_ref_type and ref_id = p_ref_id and consumed_at is null
   order by created_at limit 1
   for update;

  if not found then
    raise exception 'reversal requires the owner';
  end if;

  -- Single use: one approval must not authorise a second refund.
  update public.owner_overrides set consumed_at = now() where id = v_over.id;
end $$;

do $$
declare
  v_def    text;
  v_fn     text;
  v_anchor text;
begin
  foreach v_fn in array array['reverse_payment', 'create_and_issue_credit_note'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_def is null then raise exception 'public.% not found', v_fn; end if;
    continue when position('require_owner_or_override' in v_def) > 0;

    if position('perform app.require_role(''owner'',''manager'');' in v_def) = 0 then
      raise exception '%: role anchor not found — the owner gate was NOT installed', v_fn;
    end if;

    v_anchor := case v_fn
      when 'reverse_payment' then 'perform app.require_owner_or_override(''payment'', p_payment_id);'
      else                        'perform app.require_owner_or_override(''document'', p_invoice_id);'
    end;

    v_def := replace(v_def, 'perform app.require_role(''owner'',''manager'');',
      'perform app.require_role(''owner'',''manager'');
  -- Rule 3 (2026-08-10): the owner, or an override naming this one. See 20260810000060.
  ' || v_anchor);

    execute v_def;
  end loop;
end $$;

-- ── prove it against what is actually installed ─────────────────────────────
do $$
declare v_missing text;
begin
  select string_agg(p.proname, ', ') into v_missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('reverse_payment','create_and_issue_credit_note')
     and position('require_owner_or_override' in pg_get_functiondef(p.oid)) = 0;
  if v_missing is not null then raise exception 'the owner gate did not reach: %', v_missing; end if;

  -- The splice must not have cost reverse_payment the reason guard it already had.
  if (select position('a reason is required to reverse a payment' in pg_get_functiondef(p.oid)) = 0
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'reverse_payment') then
    raise exception 'reverse_payment lost its reason guard while learning the owner gate';
  end if;
end $$;
