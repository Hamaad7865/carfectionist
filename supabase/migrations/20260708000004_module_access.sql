-- ═══════════════════════════════════════════════════════════════════════════
-- Per-user module access. app_users.modules holds the nav sections a user may
-- reach (by href, e.g. '/sales'). NULL = fall back to the role's defaults.
-- Owners are always full-access (enforced in app code, never restricted here).
-- The role still governs data at the DB (RLS); this gates nav + routes only.
-- ═══════════════════════════════════════════════════════════════════════════
alter table app_users add column if not exists modules text[];
