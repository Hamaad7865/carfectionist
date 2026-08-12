# The typed price is the price — Rs 1000 stays Rs 1000

## The report
Owner: adding an ad-hoc line for 1000 shows Rs 1000.01. Requirement: type 1000, see 1000.

## Root cause
The shop quotes VAT-inclusive prices. A typed gross is converted to a 2dp NET
(1000 / 1.15 → 869.57) and the ledger re-adds VAT on the rounded net
(869.57 + 130.44 = 1000.01). Rs 1000 has NO exact 2dp net at 15% — the round trip
cannot land on it. This affects every TYPED price on an inclusive shop (counter
ad-hoc, quote typed lines), not just 1000.

## Design: store the typed GROSS, extract the VAT
New column `document_lines.price_includes_vat boolean not null default false`.

- flag FALSE (every existing row, catalogue lines, VAT-exclusive shops):
  formulas byte-identical to today. History untouched — proven by checksum.
- flag TRUE (a price typed on an inclusive shop): `unit_price` holds the GROSS
  exactly as typed. Generated columns extract:
    gross      = round(qty * unit_price, 2)
    net_gross  = amount-kind: greatest(gross - discount_amount, 0)
                 pct-kind:    round(gross * (1 - pct/100), 2)
    line_total_excl = round(net_gross / (1 + vat/100), 2)
    line_vat        = net_gross - line_total_excl
  Totals: 1000 → excl 869.57, vat 130.43, incl exactly 1000.00. Discounts land
  exactly too (2000 @ 10% → 1800.00 flat).

VAT on the slip reads 130.43 (extracted) not 130.44 (added) — the correct figure
for an inclusive price and what makes the total exact.

## Why not alternatives
- netWithinGross → 999.99: rejected by the owner.
- Higher-precision net: generated cols round the net first; still 1000.01. And
  fractional cents break the clients' integer-cents arithmetic.
- Changing formulas for ALL rows: regenerates history on issued invoices. Never.

## Phases
1. **DB** — column + regenerated columns (false-branch verbatim; checksum probe
   proves zero drift on existing rows), save_draft passes the flag through,
   allowance SQL: flagged line gross_incl = round(qty*unit,2), carwash
   net_at_max = round(gross*(1-cap/100),2). Rolled-back probe: flagged 1000 line
   issues at exactly 1000.00; unflagged fixtures unchanged.
2. **Web** — builder: typed lines on an inclusive shop store gross + flag;
   display skips re-grossing for flagged lines; totals + allowance.ts branch;
   getDraft round-trips the flag; tests.
3. **Tablet** — addAdhoc + quote typed lines store gross + flag (CartLine/
   QuoteLine carry it like carwashPct); lineExcl/lineGross getters, DocLineIn,
   expandSaleLines → save_draft JSON; receipt + totals branch; Allowance.kt
   branch; tests mirroring web fixtures.
4. **Prove** — DB probe, both suites, emulator: type 1000 → 1000.00 on the line,
   the total and the receipt. Adversarial review. Publish on the owner's word.

## Out of scope (say so, don't sneak it in)
Catalogue products store a 2dp net (import convention ÷1.15), so a shelf item
like the 4G dash cam still shows 9,900.01. Same fix pattern (store gross on
products) is a follow-up decision for the owner.
