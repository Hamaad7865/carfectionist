-- WhatsApp reply inbox — two-way messaging on the studio's sending number.
--
-- Why this exists: once the studio sends quotes/invoices/campaigns from a
-- WhatsApp number, customers REPLY to it. Without this, those replies hit the
-- webhook and are dropped — the number is deaf. This gives every conversation a
-- home that any front-desk operator can read and answer (better than one
-- person's phone), with the customer's name/vehicle/jobs alongside.
--
-- The 24-hour rule (Meta's, not ours): free-typed replies are only permitted
-- within 24h of the customer's last inbound message. Outside it, only an
-- approved template may be sent. last_inbound_at is what the UI counts down.

create table if not exists wa_conversations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references business_settings(id),
  phone_e164      text not null,                       -- 23052588854 (no +)
  customer_id     uuid references customers(id),       -- matched on first contact; may be null (unknown number)
  wa_name         text,                                -- WhatsApp profile name Meta sends
  last_message_at timestamptz not null default now(),  -- ordering
  last_inbound_at timestamptz,                         -- the 24h service-window clock
  unread          int not null default 0,
  archived        boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, phone_e164)
);
create index if not exists idx_wa_conv_recent on wa_conversations (tenant_id, archived, last_message_at desc);
create trigger trg_wa_conv_updated before update on wa_conversations
  for each row execute function app.set_updated_at();

create table if not exists wa_messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references business_settings(id),
  conversation_id uuid not null references wa_conversations(id) on delete cascade,
  direction       text not null check (direction in ('in','out')),
  wa_message_id   text,                                -- Meta's wamid (delivery receipts key off it)
  msg_type        text not null default 'text'
                    check (msg_type in ('text','image','document','audio','video','sticker','location','contacts','template','unsupported')),
  body            text,                                -- text / caption / template preview
  media_path      text,                                -- storage key in wa-media
  media_mime      text,
  media_name      text,
  status          text not null default 'received'
                    check (status in ('received','sent','delivered','read','failed')),
  error           text,
  -- when an outbound message IS a document/campaign we sent, thread it here
  ref_type        text check (ref_type in ('document','campaign')),
  ref_id          uuid,
  sent_by         uuid references app_users(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_wa_msg_thread on wa_messages (conversation_id, created_at);
create unique index if not exists idx_wa_msg_wamid on wa_messages (tenant_id, wa_message_id) where wa_message_id is not null;

alter table wa_conversations enable row level security;
alter table wa_messages      enable row level security;

-- Front desk operates the inbox: owner, manager, cashier (NOT technicians —
-- customer conversations are commercial). Writes go through server actions /
-- the webhook (service role), but a direct read is what the UI needs.
do $$
declare t text;
begin
  foreach t in array array['wa_conversations','wa_messages'] loop
    execute format($f$
      create policy %1$s_select on %1$s for select to authenticated
        using (tenant_id = (select app.current_tenant_id())
               and (select app.current_user_role()) in ('owner','manager','cashier'));
      create policy %1$s_insert on %1$s for insert to authenticated
        with check (tenant_id = (select app.current_tenant_id())
               and (select app.current_user_role()) in ('owner','manager','cashier'));
      create policy %1$s_update on %1$s for update to authenticated
        using (tenant_id = (select app.current_tenant_id())
               and (select app.current_user_role()) in ('owner','manager','cashier'))
        with check (tenant_id = (select app.current_tenant_id()));
    $f$, t);
  end loop;
end $$;

-- Inbound media (a customer photographs a scratch) — private, tenant-foldered.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('wa-media', 'wa-media', false, 16777216,
   array['image/jpeg','image/png','image/webp','image/gif','application/pdf',
         'audio/ogg','audio/mpeg','audio/mp4','video/mp4','video/3gpp',
         'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='wa_media_read') then
    execute $f$
      create policy wa_media_read on storage.objects for select to authenticated
        using (bucket_id = 'wa-media'
               and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
               and (select app.current_user_role()) in ('owner','manager','cashier'));
    $f$;
  end if;
end $$;
