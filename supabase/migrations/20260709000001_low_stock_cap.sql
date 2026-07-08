-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration: low-stock threshold hard cap
-- Business rule: blank/null = default 10 (client display); a custom threshold
-- may never exceed 20. Clients clamp on input; this makes the cap real.
-- ═══════════════════════════════════════════════════════════════════════════

update products set low_stock_threshold = 20 where low_stock_threshold > 20;

alter table products drop constraint if exists chk_products_low_stock_threshold;
alter table products add constraint chk_products_low_stock_threshold
  check (low_stock_threshold is null or (low_stock_threshold >= 0 and low_stock_threshold <= 20));
