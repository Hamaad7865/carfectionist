import { Cents, cents, roundHalfAwayFromZero } from './cents';

/**
 * Parse user money input into integer cents. Tolerant of "Rs", thousands commas,
 * and surrounding whitespace: "Rs 32,000.00", "32000", "32,000" → 3200000.
 * Returns null for empty or malformed input.
 */
export function parseMoneyInput(input: string): Cents | null {
  if (input == null) return null;
  const cleaned = input.replace(/rs/i, '').replace(/[,\s]/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return cents(roundHalfAwayFromZero(value * 100));
}
