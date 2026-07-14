-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — clearing a delivered card off the board
-- A delivered job ages off the board by itself after 48h, but staff can also
-- swipe it away the moment the car leaves. That's a board decision, not a
-- lifecycle one: the job row, its money and its history are untouched — only
-- its card stops being drawn. Shared, so a card swiped on the tablet is also
-- gone from the back office (and vice versa).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.jobs add column if not exists board_dismissed_at timestamptz;

comment on column public.jobs.board_dismissed_at is
  'When staff swiped this delivered card off the jobs board. Null = still on the board (subject to the 48h delivered window). Never affects documents, payments or reports.';
