-- ═══════════════════════════════════════════════════════════════════════════
-- Throttle store for "forgot password".
--
-- The reset form is the only place in the app that will send an email to an
-- address a STRANGER typed, so it is the only place someone can use us to spam
-- a third party — or grind through addresses to learn which ones have accounts.
-- The form itself answers identically either way; this is what stops the grind
-- being free.
--
-- No tenant_id on purpose: nobody is signed in when this is written, so there is
-- no tenant to attribute it to. Which is also why RLS is enabled with ZERO
-- policies — exactly like idempotency_keys. The only writer is the service-role
-- client inside the reset action, which bypasses RLS; no browser session can
-- read or write this table, and that is the point.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists password_reset_attempts (
  id           uuid primary key default gen_random_uuid(),
  email_key    text not null,               -- lower(trim(email)) as typed
  ip           text,                        -- cf-connecting-ip, when we have it
  requested_at timestamptz not null default now()
);

create index if not exists idx_pra_email on password_reset_attempts(email_key, requested_at desc);
create index if not exists idx_pra_ip    on password_reset_attempts(ip, requested_at desc);

alter table password_reset_attempts enable row level security;
-- Deliberately no policies and no grants: service role only.
revoke all on password_reset_attempts from authenticated, anon;
