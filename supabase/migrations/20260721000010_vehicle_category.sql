-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — vehicle body type / category
--
-- A detailing shop prices and plans by the car's shape (an SUV/4x4 takes more
-- product and time than a sedan), and the owner asked to record it. Kept as free
-- text so nothing is ever rejected, but both apps offer a preset list (SUV,
-- Sedan, Hatchback, Pickup, Van, …) so the wording stays consistent.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS category text;
