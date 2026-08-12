-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a catalogue product can hold its price VAT-inclusive too.
--
-- 20260812000020 let a document LINE say its unit_price is the typed gross so a
-- typed 1000 stays 1000. Catalogue products still store a NET selling_price (the
-- import divides the owner's gross shelf sheet by 1 + VAT), and that net re-grosses
-- a cent high for ~1 gross value in 8 — the 9,900 dash cam shows 9,900.01.
--
-- products.price_includes_vat is the product-level twin of the line flag. When
-- true, selling_price IS the VAT-inclusive shelf price exactly as the owner typed
-- it, and a line raised from that product inherits price_includes_vat = true with
-- that exact figure as its unit_price — so it issues on the number, not a cent off.
--
-- Nothing about the ledger changes here: the extraction lives on document_lines
-- (20260812000020). This only lets a product CARRY the exact gross so its lines
-- can be flagged. Every existing product keeps price_includes_vat = false and its
-- net selling_price, so nothing reprices until the owner re-saves a product with
-- the gross they mean.
--
-- Deliberately NOT touched: VAT returns and revenue read document_lines
-- (line_total_excl / line_vat), never products.selling_price, so a product's flag
-- cannot move a tax figure. selling_price on a flagged product is a gross, so the
-- handful of surfaces that show a shelf price or export a sheet read the flag.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products
  add column if not exists price_includes_vat boolean not null default false;

comment on column public.products.price_includes_vat is
  'True: selling_price IS the VAT-inclusive shelf price exactly as typed, and a line from this product inherits document_lines.price_includes_vat (the ledger extracts the VAT, so the total lands on the figure). False (default, all history): selling_price is net and VAT is added on top.';
