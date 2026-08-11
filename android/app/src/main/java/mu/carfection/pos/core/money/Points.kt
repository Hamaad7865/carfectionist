package mu.carfection.pos.core.money

/**
 * Loyalty points — the Kotlin mirror of apps/web/src/lib/points.ts, itself the web mirror of
 * app.award_points_for_invoice and app.spend_points (20260811000030, 20260811000040). The
 * DATABASE is the authority and record_payment refuses at the RPC; this exists so the till can
 * show a balance, cap an amount and answer "how many points is that?" before the cashier commits
 * — the same "keeps the till honest" framing as core/money/Allowance.kt.
 *
 * Everything here is integer CENTS in, integer cents out (points themselves are a bare count) —
 * that is the one unit the tablet already keeps its money in. The SQL works in rupees
 * (documents.total_incl, business_settings.* are both `numeric`), so every function below
 * divides by 100 before it matches the shape of its SQL counterpart.
 *
 *   earning:  floor((total_incl − points_paid_on_this_bill) / 100 × points_per_100)
 *   spending: ceil(amount_rupees / point_value_rupees)   -- rounds UP, the shop is never out
 *             of pocket for a fraction of a point
 *   value:    points × point_value_rupees
 */

data class EarnInput(val totalCents: Long, val pointsPaidCents: Long, val pointsPer100: Double)

/**
 * Points a settled bill earns. Rounds DOWN — a part point is not a point.
 * [EarnInput.pointsPaidCents] (whatever this invoice already collected under the 'points'
 * method) is subtracted first: without that exclusion, paying with points would earn a
 * fraction of them straight back, a balance that tops itself up and never actually goes down.
 *
 * A rate of zero or less earns nothing rather than throwing — points_per_100 only ever
 * reaches here from business_settings (CHECK'd >= 0 in the DB), but this stays defensive
 * rather than trust a caller's arithmetic.
 */
fun pointsEarned(input: EarnInput): Int {
    if (input.pointsPer100 <= 0.0) return 0
    val netCents = maxOf(input.totalCents - input.pointsPaidCents, 0L)
    return Math.floor((netCents / 100.0 / 100.0) * input.pointsPer100).toInt()
}

/** Points needed to settle [amountCents]. Rounds UP, so the shop is never out of pocket. */
fun pointsToSpend(amountCents: Long, pointValueRupees: Double): Int {
    if (pointValueRupees <= 0.0) return 0
    return Math.ceil(amountCents / 100.0 / pointValueRupees).toInt()
}

/** What a points balance is worth, in cents. */
fun pointsValueCents(points: Int, pointValueRupees: Double): Long =
    Math.round(points * pointValueRupees * 100.0)
