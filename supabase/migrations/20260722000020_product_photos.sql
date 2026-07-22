-- ═══════════════════════════════════════════════════════════════════════════
-- Product photos — one reference photo per catalogue item, so staff picking
-- from ~700 similarly-named products (batteries, wipers, ceramic packs) can
-- confirm by sight, not just by name.
--
-- PUBLIC bucket, unlike vehicle-photos/brand-assets/certificates (all private,
-- signed per render): a product photo carries no privacy sensitivity, and the
-- tablet caches the catalogue locally for offline use (CatalogRepository) — a
-- signed URL baked into that cache would go stale in an hour and break
-- offline; a public URL never expires, matching how the app-releases bucket
-- already works for the APK manifest. Writes stay tenant + role gated like
-- every other bucket; only reads are open.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products add column if not exists photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-photos', 'product-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy product_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos'
         and (storage.foldername(name))[1] = (select app.current_tenant_id())::text);
create policy product_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'product-photos'
         and (storage.foldername(name))[1] = (select app.current_tenant_id())::text);
create policy product_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos'
         and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
         and (select app.current_user_role()) in ('owner','manager'));
