import { grossCents } from "./format";

/**
 * How a saved document's lines are PRESENTED — the one authority for the back-office screen,
 * the PDF, the emailed copy and the public tokenized link.
 *
 * It exists because those surfaces each derived it themselves and disagreed: the same invoice
 * read Rate 660.00 / Amount 626.99 on its PDF and 573.91 / 545.21 on the screen, so a customer
 * querying a figure and the person answering were looking at two different documents.
 *
 * On a shop that quotes VAT-inclusive shelf prices, a line shows what the customer was told at
 * the counter. Nothing here changes what is STORED — money stays net, the DB's generated columns
 * stay the rounding authority, and vat/total come straight off the document.
 */
export interface DocLineRow {
  unit_price: number | string;
  line_total_excl: number | string;
  line_vat: number | string;
  vat_rate: number | string;
}

export interface PresentedLine {
  rateCents: number;
  amountCents: number;
}

const cents = (v: number | string) => Math.round(Number(v) * 100);

export function presentLine(l: DocLineRow, inclVat: boolean): PresentedLine {
  const excl = cents(l.line_total_excl);
  return inclVat
    ? { rateCents: grossCents(cents(l.unit_price), Number(l.vat_rate)), amountCents: excl + cents(l.line_vat) }
    : { rateCents: cents(l.unit_price), amountCents: excl };
}

/**
 * The totals block. Subtotal is summed from the very lines shown above it, so the column always
 * foots; the order discount is the gap to the document's own TOTAL, whichever of the schema's
 * three discount shapes it was stored in.
 */
export function presentTotals(lines: DocLineRow[], totalInclCents: number, inclVat: boolean) {
  const subtotalCents = lines.reduce((s, l) => s + presentLine(l, inclVat).amountCents, 0);
  const discountCents = inclVat ? subtotalCents - totalInclCents : 0;
  return { subtotalCents, discountCents: discountCents > 0 ? discountCents : undefined };
}

/**
 * What a price TYPED in the builder stores.
 *
 * One way, always. The typed figure is converted to net for storage and never converted back into
 * the box — because gross → net → gross is not an identity, and a builder that echoed the round
 * trip into its own input rewrote prices mid-keystroke: "1500" became "149.990" and stored 130.43.
 * Keep this the only conversion on the entry path.
 */
export function unitCentsFromTyped(typedCents: number, vatRatePct: number, inclVat: boolean): number {
  return inclVat ? Math.round(typedCents / (1 + vatRatePct / 100)) : typedCents;
}

/**
 * qty × Rate does not always equal Amount, and cannot, while prices are stored net on a shop that
 * quotes gross: VAT rounds once per LINE, not per unit, so 3 × Rs 12.00 bills Rs 35.00 and not
 * Rs 36.00 whenever round(qty × net × r) ≠ qty × round(net × r). Showing ex-VAT rates with a
 * separate VAT column would make every column multiply exactly, but the customer would stop seeing
 * the shelf price they were quoted. The owner chose the shelf price; this is the cost of it, it is
 * capped at a few cents per line, and every TOTAL remains exact.
 */
export const QTY_TIMES_RATE_IS_APPROXIMATE = true;
