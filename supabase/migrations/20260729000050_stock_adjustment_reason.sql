-- ═══════════════════════════════════════════════════════════════════════════
-- A manual stock adjustment could be posted with an empty note, so the owner
-- had no way to tell why stock moved outside a sale, a transfer or a job's
-- consumption. stock_movements has no "reason" column — the free-text field
-- here is "note" — and only MANUAL ADJUSTMENTS need one: a sale, a transfer
-- and a job's consumption legitimately move stock with no note at all
-- (ref_type 'invoice' / 'credit_note' / 'job_card' / 'purchase_order' /
-- 'transfer'), so a blanket NOT NULL would break every sale in the shop.
-- ref_type = 'adjustment' is exactly the manual case (see the core-schema
-- check that ties every OTHER ref_type to a ref_id, and sm_insert's own
-- "ref_type = 'adjustment'" gate on owner/manager writes).
--
-- NOT VALID: stock_movements is append-only (trg_movements_append_only), so
-- this only ever gates new rows going forward. Existing adjustment rows that
-- already have a blank note are left alone rather than made to fail a
-- migration that has no way to ask the owner what they meant at the time —
-- `alter table ... validate constraint` is left for a deliberate later pass,
-- not run here.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.stock_movements
  add constraint stock_movements_manual_adjustment_needs_note
  check (ref_type <> 'adjustment' or coalesce(btrim(note), '') <> '')
  not valid;
