-- ═══════════════════════════════════════════════════════════════════════════
-- Marketing sends have never worked. Every one dies on:
--   new row for relation "campaign_recipients" violates check constraint
--   "campaign_recipients_status_check"
--
-- 20260713000001_wa_campaigns.sql:108 created the column with seven allowed
-- statuses: pending, sent, delivered, read, failed, skipped, invalid.
--
-- 20260715000010_audit_fixes.sql then added claim_campaign_batch — the fix that
-- stops a double-click messaging a customer twice — and it works by flipping
-- rows to an EIGHTH status, 'sending', while the batch is in flight. The
-- constraint was never widened to match, so the claim itself is rejected and not
-- one message ever leaves. A double-send guard that made sending impossible.
--
-- 'sending' is the right design (it is what makes FOR UPDATE SKIP LOCKED able to
-- hand disjoint batches to overlapping senders), so the constraint moves to it.
-- ═══════════════════════════════════════════════════════════════════════════

alter table campaign_recipients drop constraint if exists campaign_recipients_status_check;
alter table campaign_recipients add constraint campaign_recipients_status_check
  check (status in ('pending','sending','sent','delivered','read','failed','skipped','invalid'));
