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
  // Optional: only the surfaces that show a discount need to pass these.
  qty?: number | string;
  discount_kind?: string | null;
  discount_pct?: number | string | null;
  discount_amount?: number | string | null;
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

export interface PresentedDiscount {
  /** What this line would have cost at full price, in the SAME basis as amountCents. */
  fullAmountCents: number;
  /** What the customer saved on it. */
  savedCents: number;
  /** How it was given: "5%" or "Rs 50.00 off". Null when there is no discount. */
  label: string;
}

/**
 * What a per-LINE discount took off, presented in the same basis as the Rate/Amount columns.
 *
 * A discounted line otherwise reads as an unexplained gap: the invoice screen showed
 * "Rate 660.00 / Amount 626.99" with nothing anywhere naming the 5% that made up the
 * difference, so the owner could see money missing and not where it went.
 *
 * Keyed off the STORED discount (discount_pct / discount_amount), never off
 * `qty × rate − amount`: VAT rounds once per line, so that subtraction is a cent or two adrift
 * on plenty of perfectly undiscounted lines and would invent a "Less Rs 0.02" on them.
 * Returns null when the line carries no discount at all.
 */
export function presentLineDiscount(l: DocLineRow, inclVat: boolean): PresentedDiscount | null {
  const pct = Number(l.discount_pct ?? 0);
  const amt = Number(l.discount_amount ?? 0);
  const byAmount = l.discount_kind === "amount" && amt > 0;
  if (!byAmount && !(pct > 0)) return null;

  const { amountCents } = presentLine(l, inclVat);
  const qty = Number(l.qty ?? 1);
  const unitNet = cents(l.unit_price);
  const rate = Number(l.vat_rate);
  // Full price by the same route the DB priced the discounted figure: net line total first,
  // then its own rounded VAT — so the saving is exact rather than a cent off its own line.
  const fullNet = Math.round(qty * unitNet);
  const fullAmountCents = inclVat ? grossCents(fullNet, rate) : fullNet;

  return {
    fullAmountCents,
    savedCents: Math.max(0, fullAmountCents - amountCents),
    label: byAmount ? `Rs ${amt.toFixed(2)} off` : `${pct}%`,
  };
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
