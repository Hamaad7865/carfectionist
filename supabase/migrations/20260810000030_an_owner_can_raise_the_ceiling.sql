-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — the owner raises a ceiling without taking the till.
--
-- Rules 1-3 of 2026-08-10 all end "…unless the owner says otherwise", and the
-- person at the till is a cashier. Roles alone cannot bridge that: making the
-- cashier an owner is the thing being prevented, and signing the owner in would
-- take the device off the operator and misattribute every sale that followed.
--
-- So: an override row, created only after the owner's own PIN is checked by the
-- same server-side path the tablet already logs in through. The PIN is verified
-- HERE, not by the caller — the route holds the service-role key and must not
-- also hold the decision.
--
-- scope states a FIGURE, not a yes. 'Up to Rs 500 off this document' cannot be
-- turned into Rs 5,000 by editing the lines after approval; the guard re-reads
-- it every time the document is issued.
--
-- consumed_at is stamped on REVERSAL overrides, which are single-use — one
-- approval must not authorise a second refund. Discount overrides are a ceiling,
-- re-checked on every issue, and a document can only be issued once.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.owner_overrides (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.business_settings(id),
  kind         text not null check (kind in ('discount','reversal')),
  ref_type     text not null check (ref_type in ('document','payment')),
  ref_id       uuid not null,
  scope        jsonb not null default '{}'::jsonb,
  reason       text not null check (length(trim(reason)) > 0),
  approved_by  uuid not null references public.app_users(id),
  created_at   timestamptz not null default now(),
  consumed_at  timestamptz
);
create index if not exists idx_owner_overrides_ref
  on public.owner_overrides (tenant_id, kind, ref_type, ref_id);

comment on table public.owner_overrides is
  'An owner''s on-the-spot approval to exceed a rule. consumed_at is stamped on reversal overrides, which are single-use — one approval must not authorise a second refund. Discount overrides are a ceiling, re-checked on every issue.';

alter table public.owner_overrides enable row level security;

-- Readable within the tenant (the builder shows "approved by X"); never
-- client-writable — app.record_owner_override is the only way in.
drop policy if exists owner_overrides_read on public.owner_overrides;
create policy owner_overrides_read on public.owner_overrides
  for select using (tenant_id = (select app.current_tenant_id()));

-- ─── the only writer ────────────────────────────────────────────────────────
-- NOTE (history repair 2026-09-10): the function body that stood here moved
-- to 20260810000080, which changed its return type (owner_overrides → jsonb).
-- CREATE OR REPLACE cannot cross that gap, and restating the old body would
-- regress the live version mid-push — so the body lives only there now. Fresh
-- setups get it from ...080; this file keeps the table, policy and comment.
-- ─────────────────────────────────────────────────────────────────────────────
