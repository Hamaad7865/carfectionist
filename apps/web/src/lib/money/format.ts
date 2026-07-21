/**
 * Format integer cents as MUR, e.g. 3200000 → "Rs 32,000.00".
 * Implemented manually (not Intl.NumberFormat) so the string is byte-identical
 * across workerd / Node / browsers — it appears on fiscal documents, so determinism
 * beats locale convention.
 */
/**
 * Net → the shelf price the customer pays. DISPLAY ONLY: prices are stored and saved NET
 * (the DB's generated columns add VAT), so never feed this back into a total or a payload.
 * Same arithmetic as CataloguePanel's sellOf.
 */
export function grossCents(netCents: number, vatRatePct: number): number {
  return Math.round(netCents * (1 + vatRatePct / 100));
}

/** The inverse: a price TYPED as a VAT-inclusive shelf figure → the net to store. */
export function netFromGrossCents(gross: number, vatRatePct: number): number {
  return Math.round(gross / (1 + vatRatePct / 100));
}

export function formatMUR(value: number): string {
  const n = Math.trunc(value);
  const negative = n < 0;
  const abs = Math.abs(n);
  const rupees = Math.floor(abs / 100);
  const cents = abs % 100;
  const grouped = String(rupees).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `Rs ${negative ? '-' : ''}${grouped}.${String(cents).padStart(2, '0')}`;
}
