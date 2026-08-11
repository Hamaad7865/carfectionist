package mu.carfection.pos.core.money

/**
 * How much of a document may be discounted — the Kotlin mirror of
 * apps/web/src/lib/money/allowance.ts, which mirrors app.document_discount_limits
 * and app.assert_discount_allowed (20260810000040). The DATABASE is the authority
 * and refuses at issue_document; this exists so the tablet can clamp an input and
 * explain the limit before the cashier fills a basket the server will not be
 * allowed to issue — and, offline, before a sale is queued that would only fail
 * on replay.
 *
 * Everything is VAT-INCLUSIVE cents, because that is the one unit a percentage
 * discount and a fixed "Rs X off" both share.
 *
 * The gross is derived the way the generated columns derive an UNDISCOUNTED
 * line — round(qty*unit) first, then its VAT — so an undiscounted document
 * reports exactly 0. Computing round(qty*unit*(1+rate/100)) instead drifts a
 * cent on fractional quantities and raises a phantom discount that would demand
 * a reason nobody owes.
 */

/** 'none' | 'carwash' | 'free' — the resolved policy. [policyOf] is what resolves 'inherit' away. */
typealias DiscountPolicy = String

const val CARWASH_MAX_PCT = 5

/** A cent of tolerance, matching app.assert_discount_allowed's 0.01. */
private const val TOLERANCE_CENTS = 1L

data class AllowanceLineInput(
    val qty: Double,
    val unitCents: Long,                // VAT-exclusive unit price
    val vatRatePct: Double,
    val policy: DiscountPolicy,
    val discountKind: String = "percent",
    val discountPct: Double = 0.0,
    val discountAmountCents: Long = 0L, // VAT-inclusive
)

/** The whole-document discount input — mirrors the web's totals.ts DocDiscount. */
data class DocDiscount(val kind: String, val value: Double)

data class Allowance(
    val ceilingCents: Long,   // the most this document may be discounted
    val freeCents: Long,      // how much of that comes from unrestricted goods lines
    val actualCents: Long,    // what it carries, line + order discounts together
    val overCeiling: Boolean, // needs the owner
    val reasonRequired: Boolean,
)

/**
 * The effective policy of a line. An explicit product policy wins; 'inherit'
 * defers to the kind. An unknown kind reads as a service, which is the safer
 * default — it withholds a discount rather than granting one.
 */
fun policyOf(productPolicy: String?, effectiveKind: String?): DiscountPolicy {
    if (!productPolicy.isNullOrEmpty() && productPolicy != "inherit") return productPolicy
    return if (effectiveKind == "product" || effectiveKind == "consumable") "free" else "none"
}

/** Round to the nearest cent, ties away from zero — the same Math.round + sign
 *  technique [grossCents] already uses; not a second rounding approach. */
private fun roundHalfAwayFromZero(value: Double): Long {
    val r = Math.round(Math.abs(value))
    return if (value < 0) -r else r
}

private fun grossInclCents(l: AllowanceLineInput): Long {
    val excl = roundHalfAwayFromZero(l.qty * l.unitCents)
    return excl + roundHalfAwayFromZero((excl * l.vatRatePct) / 100)
}

private fun netInclCents(l: AllowanceLineInput): Long {
    val base = l.qty * l.unitCents
    val excl = if (l.discountKind == "amount")
        roundHalfAwayFromZero(maxOf(base - l.discountAmountCents / (1 + l.vatRatePct / 100), 0.0))
    else
        roundHalfAwayFromZero(base * (1 - l.discountPct / 100))
    return excl + roundHalfAwayFromZero((excl * l.vatRatePct) / 100)
}

/** The most a single line may be discounted, in VAT-inclusive cents. */
/** What a line's net comes to at a given percentage off, rounded as the DB rounds. */
private fun netInclAtPct(l: AllowanceLineInput, pct: Double): Long {
    val excl = roundHalfAwayFromZero(l.qty * l.unitCents * (1 - pct / 100.0))
    return excl + roundHalfAwayFromZero((excl * l.vatRatePct) / 100)
}

/**
 * The most a single line may be discounted, in VAT-inclusive cents.
 *
 * A carwash's allowance is what a 5% discount GENUINELY removes — not 5% of the
 * gross. The two differ by about a cent per line, because the discounted net and
 * its VAT are each rounded. Measuring it the other way made a 5% line exceed its
 * own ceiling by a cent: one line's tolerance hid that, two lines' did not, and a
 * customer with two cars was refused the discount the shop is expressly allowed
 * to give. See 20260811000060.
 */
fun lineAllowanceCents(l: AllowanceLineInput): Long {
    val gross = grossInclCents(l)
    return when (l.policy) {
        "free" -> gross
        "carwash" -> maxOf(gross - netInclAtPct(l, CARWASH_MAX_PCT.toDouble()), 0L)
        else -> 0L
    }
}

fun computeAllowance(
    lines: List<AllowanceLineInput>,
    docDiscount: DocDiscount?,
    approvedMaxCents: Long? = null,
): Allowance {
    var ceiling = 0L
    var free = 0L
    var lineDisc = 0L
    var postLineGross = 0L

    for (l in lines) {
        val gross = grossInclCents(l)
        ceiling += lineAllowanceCents(l)
        if (l.policy == "free") free += gross
        val net = netInclCents(l)
        lineDisc += maxOf(gross - net, 0L)
        postLineGross += net
    }

    val order = when {
        docDiscount == null || docDiscount.value <= 0.0 -> 0L
        docDiscount.kind == "percent" ->
            minOf(roundHalfAwayFromZero((postLineGross * docDiscount.value) / 100), postLineGross)
        else -> minOf(docDiscount.value.toLong(), postLineGross)
    }

    val actual = lineDisc + order
    val allowed = maxOf(ceiling, approvedMaxCents ?: 0L)

    return Allowance(
        ceilingCents = ceiling,
        freeCents = free,
        actualCents = actual,
        overCeiling = actual > allowed + TOLERANCE_CENTS,
        // An owner's approval carries its own reason, so it answers this too.
        reasonRequired = approvedMaxCents == null && actual > free + TOLERANCE_CENTS,
    )
}
