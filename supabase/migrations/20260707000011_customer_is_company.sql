-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration 0011 (customer type flag)
-- Additive: distinguish company customers from individuals (introduced with the
-- Cashmag contact import — companies carry a Société and later a BRN/VAT number).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.customers add column if not exists is_company boolean not null default false;
