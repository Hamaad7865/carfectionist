-- ═══════════════════════════════════════════════════════════════════════════
-- Owner request: manage cars from Contacts — add, edit, and mark one "not used".
--
-- Retire, never delete: jobs, quotes and invoices reference vehicles, and a car
-- that is no longer in service still has to read on last year's paperwork.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.vehicles add column if not exists is_active boolean not null default true;

comment on column public.vehicles.is_active is
  'false = retired ("not used"): sold, scrapped, or simply no longer brought in. Kept for history; hidden from pickers.';

-- A RETIRED car releases its plate.
--
-- The unique index was over every row, so once a plate existed it could never be
-- registered again — even after the car was sold to someone else, which in Mauritius
-- happens constantly. That is not a hypothetical: it is precisely how a live job ended
-- up against a vehicle plated "NIL", because staff could not re-use a plate the system
-- had already seen and typed a placeholder to get past it.
--
-- Scoping uniqueness to ACTIVE vehicles keeps the real guarantee — one live car per
-- plate — while letting a retired registration be reissued to its new owner.
-- It is a table CONSTRAINT, not a bare index, so it has to be dropped as one — the
-- index cannot be dropped while the constraint owns it.
alter table public.vehicles drop constraint if exists vehicles_tenant_id_plate_normalized_key;
create unique index if not exists vehicles_active_plate_key
  on public.vehicles (tenant_id, plate_normalized) where is_active;
