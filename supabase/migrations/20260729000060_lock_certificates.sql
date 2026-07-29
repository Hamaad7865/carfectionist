-- ═══════════════════════════════════════════════════════════════════════════
-- Put a lock behind the certificate role gate.
--
-- 20260729000040 added void_certificate() and gated it to owner/manager. That
-- gate only governs the RPC. The certificates table itself still carried the
-- blanket `grant insert, update, delete ... to authenticated` from 0001, and its
-- RLS policies check only the tenant — so any signed-in technician could PATCH
-- the row directly: un-void a warranty, extend one to 999 months, or mint one
-- for a job that was never done or paid. Confirmed by doing it as a real
-- technician session against production (inside a rolled-back transaction).
--
-- A certificate is a promise the shop makes in writing about work it did. It is
-- documents-shaped, so it gets the documents treatment
-- (20260711000001_lock_document_money_columns.sql): the write paths stay, but
-- only for the roles that are answerable for them.
--
-- Why role-scoped POLICIES rather than revoking the grant outright: the web
-- create path inserts directly (features/certificates/actions.ts), so revoking
-- INSERT would break issuing a certificate at the counter. Narrowing the policy
-- keeps that working for the people who should be doing it, and closes it for
-- everyone else. DELETE needs nothing — RLS is enabled and there has never been
-- a delete policy, so it is already denied.
-- ═══════════════════════════════════════════════════════════════════════════

-- Issuing is counter work: whoever can take the money can hand over the paper.
drop policy if exists cert_insert on public.certificates;
create policy cert_insert on public.certificates for insert to authenticated
  with check (
    tenant_id = (select app.current_tenant_id())
    and (select app.current_user_role()) in ('owner', 'manager', 'cashier')
  );

-- Changing one after the fact is not. Voiding goes through void_certificate(),
-- which is SECURITY DEFINER and writes the audit row; this policy is what makes
-- that the only route for anyone below manager.
drop policy if exists cert_update on public.certificates;
create policy cert_update on public.certificates for update to authenticated
  using (
    tenant_id = (select app.current_tenant_id())
    and (select app.current_user_role()) in ('owner', 'manager')
  )
  with check (
    tenant_id = (select app.current_tenant_id())
    and (select app.current_user_role()) in ('owner', 'manager')
  );
