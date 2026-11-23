-- Document artwork belongs to the shop that owns it.
--
-- DocumentA4 used to fall back to the Diamondbrite banners and logo whenever a shop's
-- template left a slot blank, so every other business on this database (the tyre centre,
-- the HAZ demo) printed Carfectionist's letterhead. The code fallback is gone; from now
-- on a blank slot prints nothing. Data only — no logic.
--
-- 1. Carfectionist's live template stores its header and footer but its logo slot was
--    null and relied on the fallback. Pin it so its documents (re-prints of issued
--    invoices included) look exactly as before. Guarded on the old null value.
update public.document_templates
   set config = jsonb_set(config, '{logo_path}', '"/brand/diamondbrite-logo.png"'),
       updated_at = now()
 where tenant_id = '11111111-1111-4111-8111-000000000001'
   and is_default
   and coalesce(config->>'logo_path', '') = '';

-- 2. The Carfectionist TEST Sandbox had no template and printed the fallback. Give it a
--    copy of the live one so rehearsals still look like the real documents.
insert into public.document_templates (tenant_id, name, doc_type, is_default, config)
select '22222222-2222-4222-8222-000000000002', t.name, t.doc_type, true, t.config
  from public.document_templates t
 where t.tenant_id = '11111111-1111-4111-8111-000000000001'
   and t.is_default
   and exists (select 1 from public.business_settings where id = '22222222-2222-4222-8222-000000000002')
   and not exists (
     select 1 from public.document_templates
      where tenant_id = '22222222-2222-4222-8222-000000000002' and is_default
   )
 limit 1;
