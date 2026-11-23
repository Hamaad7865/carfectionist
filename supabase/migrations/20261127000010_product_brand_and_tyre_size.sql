-- A product says who makes it, and a tyre says what size it is.
--
-- brand: free text on EVERY product (all categories, all shops), e.g. "Michelin", "Meguiar's".
-- Tyre size, structured so the back office and the tablet can answer "which brands do I have
-- in 205/55 R16?" and "which sizes does Michelin come in?" without reading product names:
--   tyre_width        205   (mm)
--   tyre_profile       55   (aspect ratio, %)
--   tyre_rim           16   (inches; numeric for 17.5 / 19.5 / 22.5 light-truck rims)
--   tyre_load_index   '91'  (text: a dual index reads "121/119")
--   tyre_speed_rating 'H'
--
-- Columns only — no function, no trigger. The forms, the filters and the size parser live in
-- TypeScript (apps/web/src/lib/products/tyre-size.ts) and Kotlin (core/catalog/TyreSize.kt),
-- held to one shared fixture. Range checks are the form's job (zod); the database only refuses
-- a negative or zero dimension. Every column is nullable and defaults to null, so adding them
-- rewrites nothing and every existing product reads exactly as before.
--
-- import_products is NOT changed: it updates/inserts named columns only, so a spreadsheet import
-- leaves these untouched; the web import action sets them afterwards from the brand / tyre_size /
-- load_index / speed_rating columns, matching rows the same way import_products does.

alter table public.products
  add column if not exists brand             text,
  add column if not exists tyre_width        smallint,
  add column if not exists tyre_profile      smallint,
  add column if not exists tyre_rim          numeric(3,1),
  add column if not exists tyre_load_index   text,
  add column if not exists tyre_speed_rating text;

alter table public.products
  drop constraint if exists products_tyre_size_positive;
alter table public.products
  add constraint products_tyre_size_positive check (
        (tyre_width   is null or tyre_width   > 0)
    and (tyre_profile is null or tyre_profile > 0)
    and (tyre_rim     is null or tyre_rim     > 0)
  );

-- The size lookup: a tyre shop's catalogue filtered to one size.
create index if not exists idx_products_tyre_size
  on public.products (tenant_id, tyre_width, tyre_profile, tyre_rim)
  where tyre_width is not null;

-- Brand lists are grouped case-insensitively ("MICHELIN" and "Michelin" are one brand).
create index if not exists idx_products_brand
  on public.products (tenant_id, lower(brand))
  where brand is not null;

comment on column public.products.brand is 'Maker / brand, free text, any product. Grouped case-insensitively.';
comment on column public.products.tyre_width is 'Tyre section width in mm (205 in 205/55 R16).';
comment on column public.products.tyre_profile is 'Tyre aspect ratio in % (55 in 205/55 R16).';
comment on column public.products.tyre_rim is 'Rim diameter in inches (16 in 205/55 R16; 17.5 allowed).';
comment on column public.products.tyre_load_index is 'Load index as printed (91, or 121/119).';
comment on column public.products.tyre_speed_rating is 'Speed rating letter (H, V, W...).';
