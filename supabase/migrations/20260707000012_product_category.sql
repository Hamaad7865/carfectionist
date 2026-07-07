-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration 0012 (product category)
-- Additive: a free-text category (from the Cashmag "Rubrique") so the 452-item
-- catalogue can be grouped/filtered. Nullable; no behavioural change.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.products add column if not exists category text;
create index if not exists idx_products_category on public.products (tenant_id, category);
