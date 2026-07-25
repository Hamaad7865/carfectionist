-- ═══════════════════════════════════════════════════════════════════════════
-- documents.bill_no — the receipt's "Bill 1-N00003210" line.
--
-- The studio's old till printed TWO references per sale: the fiscal VAT invoice
-- number and a bill number counting every order opened (theirs ran ahead of the
-- invoice series, because it counted orders that never became invoices). We keep
-- one fiscal series (INV-####) and add this as an internal, non-fiscal reference
-- so the slip can carry both, as the owner's reference receipt does.
--
-- Deliberately a column DEFAULT off a sequence, NOT an allocation inside
-- issue_document: that RPC is the live money path and this number is cosmetic —
-- Postgres assigns it on insert with no change to any RPC, trigger, or fiscal
-- lock. A sequence may gap on a rolled-back insert, which is correct here: this
-- is a reference, not a gapless fiscal series (INV-#### remains that).
-- ═══════════════════════════════════════════════════════════════════════════

create sequence if not exists public.documents_bill_no_seq as bigint start 1;

alter table public.documents
  add column if not exists bill_no bigint default nextval('public.documents_bill_no_seq');

comment on column public.documents.bill_no is
  'Internal order reference printed on the receipt as "Bill <terminal>-N########". Not a fiscal series — documents.number is.';

-- Existing rows predate the column; number them in creation order so a reprint of
-- an old sale still shows a bill reference rather than a blank line.
update public.documents
   set bill_no = nextval('public.documents_bill_no_seq')
 where bill_no is null;

-- The sequence is server-side only; clients never set this column.
revoke update (bill_no) on public.documents from authenticated;
