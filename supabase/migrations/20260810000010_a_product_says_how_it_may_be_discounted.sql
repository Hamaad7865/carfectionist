-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a product says how much of it may be given away.
--
-- The owner's rule (2026-08-10): no discount on a service, except a carwash,
-- which may go to 5% and only with a reason. Nothing in the catalogue could
-- express that. All 102 service rows sit in the single category
-- 'CAR WASH EXPERTS', which covers both a Rs 621 WASH & VACUUM and a Rs 16,086
-- BODY POLISH — so category cannot answer, and neither can kind.
--
-- 'inherit' derives the answer from the kind, which is right for the 795 rows
-- already on file: a service gives nothing away, goods are unchanged. The owner
-- then ticks 'carwash' on the seven wash services.
--
-- 'free' is not decoration. SPONGE, WHEEL BRUSH and SET 2 SOFT BRUSH are goods
-- wearing kind='service' in the live catalogue; without an explicit escape they
-- would be frozen by a rule that was never aimed at them.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products
  add column if not exists discount_policy text not null default 'inherit'
    check (discount_policy in ('inherit','none','carwash','free'));

comment on column public.products.discount_policy is
  'How much of this line may be discounted. inherit = derive from kind (service -> none, goods -> free); none = nothing; carwash = up to 5% with a reason; free = unrestricted.';
