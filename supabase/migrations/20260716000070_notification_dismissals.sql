-- ═══════════════════════════════════════════════════════════════════════════
-- Dismissible bell alerts (owner request: "if I click on the current
-- notification and its 1 the one always gets displayed").
--
-- The subtlety: these alerts are LIVE CONDITIONS, not messages. "11 products
-- low at the shop" is true until someone restocks, so a dismissal cannot mean
-- "delete" — the condition would just be recomputed and reappear. It means
-- "I have seen this today", and it holds only while the alert stays the size it
-- was:
--   • seen_count   — how big it was when dismissed. If it GROWS (a 4th enquiry
--     arrives after you dismissed 3) that is genuinely new, so it comes back.
--   • dismissed_day — the Mauritius business day (passed in by the app, never
--     now()::date, which is UTC and would roll over at 4am local). Tomorrow the
--     alert returns if it is still true.
--
-- Per user, not per tenant: Anesh clearing his bell must not clear Anshika's.
-- One row per (user, alert) — a dismissal is a current fact, so it is upserted
-- in place rather than appended.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists notification_dismissals (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references business_settings(id),
  app_user_id   uuid not null references app_users(id) on delete cascade,
  key           text not null,
  seen_count    int not null check (seen_count >= 0),
  dismissed_day date not null,
  dismissed_at  timestamptz not null default now(),
  unique (app_user_id, key)
);
create index if not exists idx_notif_dismissals_user on notification_dismissals(app_user_id);

alter table notification_dismissals enable row level security;

-- Yours and only yours, in your tenant. No role gate: every staff member has a
-- bell, and clearing your own is not a privileged act.
create policy nd_select on notification_dismissals for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app_user_id = (select app.current_app_user_id()));
create policy nd_insert on notification_dismissals for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and app_user_id = (select app.current_app_user_id()));
create policy nd_update on notification_dismissals for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app_user_id = (select app.current_app_user_id()))
  with check (tenant_id = (select app.current_tenant_id()) and app_user_id = (select app.current_app_user_id()));
create policy nd_delete on notification_dismissals for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app_user_id = (select app.current_app_user_id()));

grant select, insert, update, delete on notification_dismissals to authenticated;
