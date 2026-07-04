import { Cents, cents, roundHalfAwayFromZero } from './cents';

/**
 * VAT/line arithmetic, mirroring the Postgres generated columns exactly:
 *   line_total_excl = round(qty * unit_price * (1 - discount_pct/100), 2)
 *   line_vat        = round(line_total_excl * vat_rate/100, 2)
 * Rounding is line-level (2dp), then summed — never re-rounded at document level.
 */

export interface TotalsLineInput {
  qty: number;
  unitCents: number;   // Cents
  discountPct?: number; // 0..100
  vatRatePct: number;   // e.g. 15
}

export interface LineTotals {
  exclCents: Cents;
  vatCents: Cents;
}

export interface DocumentTotals {
  lines: LineTotals[];
  subtotalCents: Cents;
  vatCents: Cents;
  totalCents: Cents;
}

export function computeLineTotals(line: TotalsLineInput): LineTotals {
  const discount = line.discountPct ?? 0;
  const excl = roundHalfAwayFromZero(line.qty * line.unitCents * (1 - discount / 100));
  const vat = roundHalfAwayFromZero(excl * (line.vatRatePct / 100));
  return { exclCents: cents(excl), vatCents: cents(vat) };
}

export function computeTotals(lines: TotalsLineInput[]): DocumentTotals {
  const lt = lines.map(computeLineTotals);
  const subtotalCents = lt.reduce((s, l) => s + l.exclCents, 0);
  const vatCents = lt.reduce((s, l) => s + l.vatCents, 0);
  return {
    lines: lt,
    subtotalCents: cents(subtotalCents),
    vatCents: cents(vatCents),
    totalCents: cents(subtotalCents + vatCents),
  };
}
