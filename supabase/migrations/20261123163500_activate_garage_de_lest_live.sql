-- Garage De L'Est is an operational shop, not a rehearsal tenant. Keep sandbox
-- protections in place for the remaining test tenants while allowing its owner
-- to save the legal identity required for fiscal documents.
do $$
declare
  v_tenant constant uuid := '1f060b86-ad63-4dc7-93fb-a1fdfae18b27';
  v_is_sandbox boolean;
begin
  select is_sandbox
    into strict v_is_sandbox
    from public.business_settings
   where id = v_tenant;

  if v_is_sandbox then
    if exists (
      select 1
        from public.documents
       where tenant_id = v_tenant
         and number is not null
         and status <> 'void'
    ) or exists (
      select 1 from public.payments where tenant_id = v_tenant
    ) or exists (
      select 1 from public.stock_movements where tenant_id = v_tenant
    ) then
      raise exception 'refusing to activate a tenant with sandbox fiscal activity';
    end if;

    update public.business_settings
       set is_sandbox = false,
           sandbox_send_to = null
     where id = v_tenant;
  end if;
end $$;