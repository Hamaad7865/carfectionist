-- ═══════════════════════════════════════════════════════════════════════════
-- Marketing module — WhatsApp campaigns via the Meta Cloud API.
-- Owner request (2026-07-13): mass WhatsApp marketing — compose texts on the
-- web, pick contacts, send. Decision: OFFICIAL WhatsApp Business Cloud API
-- (paid, template-based), owner-only access.
--   • wa_templates — the message designs. Marketing texts must be pre-approved
--     by Meta, so a "message" is a template with numbered {{n}} variables;
--     rows track the Meta submission status (draft→pending→approved/rejected).
--   • campaigns — one blast: an approved template + a variable mapping + an
--     audience snapshot.
--   • campaign_recipients — one row per contact with the rendered variable
--     values; the Worker sends via the Graph API and Meta's webhook flips
--     sent→delivered→read (or failed) by wa_message_id.
--   • customers.wa_opt_out — excluded from every audience.
-- Operational data → direct table writes under RLS (no invariants needing
-- definer RPCs). All three tables are OWNER-ONLY by policy; the delivery
-- webhook writes via the service role (signature-verified route).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── customers.wa_opt_out ────────────────────────────────────────────────────
alter table customers add column if not exists wa_opt_out boolean not null default false;

-- ─── wa_templates ────────────────────────────────────────────────────────────
create table if not exists wa_templates (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references business_settings(id),
  name             text not null check (name ~ '^[a-z0-9_]{1,120}$'), -- Meta naming rules
  language         text not null default 'en' check (language in ('en','fr')),
  category         text not null default 'MARKETING' check (category in ('MARKETING','UTILITY')),
  body             text not null check (length(body) between 1 and 1024), -- Meta body limit
  variable_count   int  not null default 0 check (variable_count between 0 and 10),
  status           text not null default 'draft' check (status in ('draft','pending','approved','rejected')),
  reject_reason    text,
  meta_template_id text,                      -- Graph API id once submitted
  created_by       uuid references app_users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, name, language)
);
create trigger trg_wa_templates_updated before update on wa_templates
  for each row execute function app.set_updated_at();

alter table wa_templates enable row level security;
create policy wat_select on wa_templates for select to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) = 'owner');
create policy wat_insert on wa_templates for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id())
              and (select app.current_user_role()) = 'owner');
create policy wat_update on wa_templates for update to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) = 'owner')
  with check (tenant_id = (select app.current_tenant_id())
              and (select app.current_user_role()) = 'owner');
-- Draft/rejected designs can be discarded; anything submitted-or-approved stays
-- (campaigns may reference it, and Meta history should remain explainable).
create policy wat_delete on wa_templates for delete to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) = 'owner'
         and status in ('draft','rejected'));
grant select, insert, update, delete on wa_templates to authenticated;

-- ─── campaigns ───────────────────────────────────────────────────────────────
create table if not exists campaigns (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references business_settings(id),
  name           text not null check (length(name) between 1 and 120),
  wa_template_id uuid not null references wa_templates(id),
  variable_map   jsonb not null default '{}', -- {"1":"first_name","2":"static:July promo"}
  audience       jsonb not null default '{}', -- filter snapshot for the audit trail
  status         text not null default 'draft' check (status in ('draft','sending','done','failed','archived')),
  created_by     uuid references app_users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_campaigns_tenant on campaigns(tenant_id, created_at desc);
create trigger trg_campaigns_updated before update on campaigns
  for each row execute function app.set_updated_at();

alter table campaigns enable row level security;
create policy cmp_select on campaigns for select to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) = 'owner');
create policy cmp_insert on campaigns for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id())
              and (select app.current_user_role()) = 'owner');
create policy cmp_update on campaigns for update to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) = 'owner')
  with check (tenant_id = (select app.current_tenant_id())
              and (select app.current_user_role()) = 'owner');
-- Only unsent campaigns may be deleted; sent ones are archived, never erased.
create policy cmp_delete on campaigns for delete to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) = 'owner'
         and status = 'draft');
grant select, insert, update, delete on campaigns to authenticated;

-- ─── campaign_recipients ─────────────────────────────────────────────────────
create table if not exists campaign_recipients (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references business_settings(id),
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  customer_id   uuid not null references customers(id),
  phone_e164    text,                          -- digits only, e.g. 23052588854; null → invalid
  variables     jsonb not null default '[]',   -- positional rendered values ["Anesh", ...]
  status        text not null default 'pending'
                check (status in ('pending','sent','delivered','read','failed','skipped','invalid')),
  wa_message_id text,                          -- Graph send response; webhook correlation key
  error         text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (campaign_id, customer_id)
);
create index if not exists idx_recipients_campaign on campaign_recipients(campaign_id, status);
create index if not exists idx_recipients_wamid on campaign_recipients(wa_message_id) where wa_message_id is not null;
create trigger trg_campaign_recipients_updated before update on campaign_recipients
  for each row execute function app.set_updated_at();

alter table campaign_recipients enable row level security;
create policy rcp_select on campaign_recipients for select to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) = 'owner');
create policy rcp_insert on campaign_recipients for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id())
              and (select app.current_user_role()) = 'owner');
create policy rcp_update on campaign_recipients for update to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.current_user_role()) = 'owner')
  with check (tenant_id = (select app.current_tenant_id())
              and (select app.current_user_role()) = 'owner');
-- Recipients vanish only with their draft campaign (fk cascade); no direct delete policy.
grant select, insert, update on campaign_recipients to authenticated;
