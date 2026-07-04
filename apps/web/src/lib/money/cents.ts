/**
 * Integer-cents money core. All money in app code is integer cents (rupees × 100);
 * JS numbers are exact for integers well beyond any MUR amount. Rounding happens in
 * exactly one place — `roundHalfAwayFromZero` — to mirror Postgres `round(x, 2)`.
 * The database's generated columns are the ultimate authority; these helpers keep
 * the live UI in lock-step with them (pinned by docs/vat-test-vectors.json).
 */

export type Cents = number & { readonly __cents: unique symbol };

export const cents = (n: number): Cents => n as Cents;

/** Round to the nearest integer, ties away from zero (matches Postgres round()). */
export function roundHalfAwayFromZero(value: number): number {
  const r = Math.round(Math.abs(value));
  return value < 0 ? -r : r;
}

export function rupeesToCents(rupees: number): Cents {
  return cents(roundHalfAwayFromZero(rupees * 100));
}

export function centsToRupees(value: number): number {
  return value / 100;
}
