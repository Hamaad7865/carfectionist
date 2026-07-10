import { Cents, cents, roundHalfAwayFromZero } from './cents';

/**
 * VAT/line arithmetic, mirroring the Postgres generated columns + the order-level
 * discount trigger (app.discounted_vat_groups) EXACTLY:
 *   line_total_excl = round( amount ? greatest(qty*unit - discAmt/(1+vat/100), 0)
 *                                   : qty*unit*(1 - discPct/100), 2 )
 *   line_vat        = round(line_total_excl * vat/100, 2)
 * Order discount is apportioned across VAT-rate groups by inclusive share
 * (largest-remainder), then each group's net is re-derived from its discounted
 * inclusive amount. Prices are VAT-inclusive, so a fixed "Rs X off" is inclusive.
 * Rounding is 2dp (integer cents), ties away from zero — the single authority.
 */

export type DiscountKind = 'percent' | 'amount';

export interface TotalsLineInput {
  qty: number;
  unitCents: number;              // Cents, VAT-exclusive unit price
  discountPct?: number;           // 0..100 (when kind = 'percent')
  discountKind?: DiscountKind;    // default 'percent'
  discountAmountCents?: number;   // Cents, VAT-INCLUSIVE (when kind = 'amount')
  vatRatePct: number;             // e.g. 15
}

/** value: percent = 0..100 ; amount = Cents (VAT-inclusive) off the whole total */
export interface DocDiscount {
  kind: DiscountKind;
  value: number;
}

export interface LineTotals {
  exclCents: Cents;
  vatCents: Cents;
}

export interface DocumentTotals {
  lines: LineTotals[];
  subtotalCents: Cents;      // post-order-discount taxable base
  vatCents: Cents;           // post-order-discount VAT
  totalCents: Cents;         // post-order-discount inclusive total
  grossSubtotalCents: Cents; // sum of line_total_excl (pre-order-discount)
  discountCents: Cents;      // the order discount actually applied (inclusive)
}

export function computeLineTotals(line: TotalsLineInput): LineTotals {
  const base = line.qty * line.unitCents;
  let excl: number;
  if (line.discountKind === 'amount') {
    excl = roundHalfAwayFromZero(Math.max(base - (line.discountAmountCents ?? 0) / (1 + line.vatRatePct / 100), 0));
  } else {
    excl = roundHalfAwayFromZero(base * (1 - (line.discountPct ?? 0) / 100));
  }
  const vat = roundHalfAwayFromZero(excl * (line.vatRatePct / 100));
  return { exclCents: cents(excl), vatCents: cents(vat) };
}

export function computeTotals(lines: TotalsLineInput[], docDiscount?: DocDiscount | null): DocumentTotals {
  const lt = lines.map(computeLineTotals);
  const grossSubtotal = lt.reduce((s, l) => s + l.exclCents, 0);

  // group by VAT rate: base0, vat0, inclusive
  const byRate = new Map<number, { base: number; vat: number }>();
  lines.forEach((l, i) => {
    const g = byRate.get(l.vatRatePct) ?? { base: 0, vat: 0 };
    g.base += lt[i].exclCents;
    g.vat += lt[i].vatCents;
    byRate.set(l.vatRatePct, g);
  });
  const groups = [...byRate.entries()].map(([rate, g]) => ({ rate, base0: g.base, vat0: g.vat, incl: g.base + g.vat }));
  const gross = groups.reduce((s, g) => s + g.incl, 0);

  const active = !!docDiscount && docDiscount.value > 0 && gross > 0;
  const dIncl = !active ? 0
    : docDiscount!.kind === 'percent'
      ? Math.min(roundHalfAwayFromZero(gross * (docDiscount!.value / 100)), gross) // never exceed the total
      : Math.min(docDiscount!.value, gross);

  // apportion largest-remainder: order by inclusive share desc, then rate asc
  const ordered = groups.map((g) => ({ ...g })).sort((a, b) => (b.incl - a.incl) || (a.rate - b.rate));
  let allocated = 0;
  const dRaw = ordered.map((g) => {
    const d = active ? roundHalfAwayFromZero((dIncl * g.incl) / gross) : 0;
    allocated += d;
    return d;
  });
  if (active && ordered.length > 0) dRaw[0] += dIncl - allocated; // residual to the largest group

  let subtotal = 0;
  let vat = 0;
  ordered.forEach((g, k) => {
    if (!active) { subtotal += g.base0; vat += g.vat0; return; }
    const ni = g.incl - dRaw[k];
    const nb = roundHalfAwayFromZero(ni / (1 + g.rate / 100));
    subtotal += nb;
    vat += ni - nb;
  });

  return {
    lines: lt,
    subtotalCents: cents(subtotal),
    vatCents: cents(vat),
    totalCents: cents(subtotal + vat),
    grossSubtotalCents: cents(grossSubtotal),
    discountCents: cents(dIncl),
  };
}
