/**
 * Loyalty points — the web mirror of app.award_points_for_invoice and
 * app.spend_points (20260811000030, 20260811000040). The DATABASE is the
 * authority and record_payment refuses at the RPC; this exists so the till
 * can show a balance, cap an amount and answer "how many points is that?"
 * before the cashier commits — the same "keeps the till honest" framing as
 * lib/money/allowance.ts.
 *
 * Everything here is integer CENTS in, integer cents out (points themselves
 * are a bare count) — that is the one unit the web already keeps its money
 * in. The SQL works in rupees (documents.total_incl, business_settings.*
 * are both `numeric`), so every function below divides by 100 before it
 * matches the shape of its SQL counterpart.
 *
 *   earning:  floor((total_incl − points_paid_on_this_bill) / 100 × points_per_100)
 *   spending: ceil(amount_rupees / point_value_rupees)   -- rounds UP, the
 *             shop is never out of pocket for a fraction of a point
 *   value:    points × point_value_rupees
 */

export interface EarnInput {
  totalCents: number;
  pointsPaidCents: number;
  pointsPer100: number;
}

/**
 * Points a settled bill earns. Rounds DOWN — a part point is not a point.
 * `pointsPaidCents` (whatever this invoice already collected under the
 * 'points' method) is subtracted first: without that exclusion, paying with
 * points would earn a fraction of them straight back, a balance that tops
 * itself up and never actually goes down.
 *
 * A rate of zero or less earns nothing rather than throwing — points_per_100
 * only ever reaches here from business_settings (CHECK'd >= 0 in the DB), but
 * this stays defensive rather than trust a caller's arithmetic.
 */
export function pointsEarned({ totalCents, pointsPaidCents, pointsPer100 }: EarnInput): number {
  if (pointsPer100 <= 0) return 0;
  const netCents = Math.max(totalCents - pointsPaidCents, 0);
  return Math.floor((netCents / 100 / 100) * pointsPer100);
}

/** Points needed to settle `amountCents`. Rounds UP, so the shop is never out of pocket. */
export function pointsToSpend(amountCents: number, pointValueRupees: number): number {
  if (pointValueRupees <= 0) return 0;
  return Math.ceil(amountCents / 100 / pointValueRupees);
}

/** What a points balance is worth, in cents. */
export function pointsValueCents(points: number, pointValueRupees: number): number {
  return Math.round(points * pointValueRupees * 100);
}
