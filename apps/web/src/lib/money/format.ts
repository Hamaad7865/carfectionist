/**
 * Format integer cents as MUR, e.g. 3200000 → "Rs 32,000.00".
 * Implemented manually (not Intl.NumberFormat) so the string is byte-identical
 * across workerd / Node / browsers — it appears on fiscal documents, so determinism
 * beats locale convention.
 */
export function formatMUR(value: number): string {
  const n = Math.trunc(value);
  const negative = n < 0;
  const abs = Math.abs(n);
  const rupees = Math.floor(abs / 100);
  const cents = abs % 100;
  const grouped = String(rupees).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `Rs ${negative ? '-' : ''}${grouped}.${String(cents).padStart(2, '0')}`;
}
