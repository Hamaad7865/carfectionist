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
create or replace function app.record_owner_override(
  p_app_user_id uuid,
  p_pin         text,
  p_kind        text,
  p_ref_type    text,
  p_ref_id      uuid,
  p_reason      text,
  p_scope       jsonb default '{}'::jsonb
) returns public.owner_overrides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_check jsonb;
  v_user  public.app_users;
  v_row   public.owner_overrides;
begin
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'an override requires a reason';
  end if;

  select * into v_user from public.app_users where id = p_app_user_id;
  if not found or not v_user.is_active then raise exception 'unknown approver'; end if;
  if v_user.role <> 'owner' then raise exception 'only the owner can approve an override'; end if;

  -- The PIN is checked HERE. verify_staff_pin carries the per-user lockout that
  -- makes a 4-digit secret survivable.
  v_check := public.verify_staff_pin(p_app_user_id, p_pin);
  if not coalesce((v_check->>'ok')::boolean, false) then
    raise exception 'owner PIN rejected (%)', coalesce(v_check->>'reason','invalid');
  end if;

  insert into public.owner_overrides (tenant_id, kind, ref_type, ref_id, scope, reason, approved_by)
  values (v_user.tenant_id, p_kind, p_ref_type, p_ref_id, coalesce(p_scope,'{}'::jsonb), trim(p_reason), p_app_user_id)
  returning * into v_row;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_user.tenant_id, p_app_user_id, 'owner_override', p_ref_type, p_ref_id,
          jsonb_build_object('kind', p_kind, 'reason', trim(p_reason), 'scope', p_scope));

  return v_row;
end $$;

-- Service role only: this function decides who the owner is, so it must not be
-- reachable from a browser or a tablet session.
revoke execute on function app.record_owner_override(uuid, text, text, text, uuid, text, jsonb) from public;
revoke execute on function app.record_owner_override(uuid, text, text, text, uuid, text, jsonb) from authenticated;
grant  execute on function app.record_owner_override(uuid, text, text, text, uuid, text, jsonb) to service_role;
