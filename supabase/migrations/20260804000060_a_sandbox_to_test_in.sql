-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — somewhere to test that can actually be undone.
--
-- Testing has been happening on the live books, and on a fiscal ledger that is
-- a one-way door. Void is the only reversal the law allows: every rehearsal
-- burns a real invoice number, a test payment lands in the day's cash-up beside
-- the shop's real takings, and a test sale takes stock off the real shelf. "Put
-- it back the way it was" is not a request the live tenant can honour.
--
-- It does not have to. Every one of the 44 tables that matter carries
-- tenant_id, numbering is issued per tenant, and app.current_tenant_id() reads
-- the tenant off whoever is signed in. So a SECOND tenant is a real sandbox:
-- its own quote and invoice sequences starting at 1, its own stock, its own
-- tills, its own trading days and Z-reports. Nothing it does can be seen by
-- Diamondbrite's books, and — the point of the exercise —
--   delete from … where tenant_id = <sandbox>
-- provably cannot reach the real company.
--
-- Two columns carry the difference:
--   • is_sandbox      — this company is a rehearsal. Read by the send path.
--   • sandbox_send_to — where its quotations actually go, so testing the send
--                       flow can never put a test PDF in a customer's WhatsApp.
--
-- The CHECK is the part that matters. A sandbox may not hold a BRN or a VAT
-- number: those are what make a PDF look like the real company, and a test
-- invoice that could be mistaken for a real one is worse than no sandbox.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.business_settings
  add column if not exists is_sandbox      boolean not null default false,
  add column if not exists sandbox_send_to text;

comment on column public.business_settings.is_sandbox is
  'This tenant is a rehearsal space. Its documents are not the shop''s books, and its sends are redirected to sandbox_send_to.';
comment on column public.business_settings.sandbox_send_to is
  'Every send from a sandbox tenant goes here instead of the customer — an email address or a Mauritius number.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_settings_sandbox_is_not_a_real_company'
  ) then
    alter table public.business_settings
      add constraint business_settings_sandbox_is_not_a_real_company
      check (not is_sandbox or (brn is null and vat_number is null));
  end if;
end $$;

-- ── prove it ────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'business_settings' and column_name = 'is_sandbox'
  ) then raise exception 'is_sandbox did not install'; end if;

  -- The live company must never be flipped into a sandbox by accident: it has a
  -- BRN, so the constraint refuses. Assert that here rather than trusting it.
  begin
    update public.business_settings set is_sandbox = true
     where brn is not null and id = (select id from public.business_settings where brn is not null limit 1);
    raise exception 'a company with a BRN was allowed to become a sandbox';
  exception when check_violation then
    null; -- refused, as it must be
  end;
end $$;
