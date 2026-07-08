package mu.carfection.pos.core.money

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Money = integer CENTS (Long) everywhere in the app, mirroring the web client
 * and the DB (numeric(12,2) rupees; the DB is the rounding authority).
 *
 * VAT rule (spec): line level, 2dp, round half away from zero, then sum.
 * Never re-round at document level. Canonical vector:
 * 1×32,000 + 4×3,800 + 1×30,000 @15% → 77,200.00 / 11,580.00 / 88,780.00.
 */

data class LineInput(
    val qty: Double,
    val unitCents: Long,
    val discountPct: Double = 0.0,
    val vatRatePct: Double,
)

data class LineTotals(val exclCents: Long, val vatCents: Long)

data class DocTotals(
    val lines: List<LineTotals>,
    val subtotalCents: Long,
    val vatCents: Long,
    val totalCents: Long,
)

/** Round half away from zero to whole cents (java HALF_UP never decreases magnitude — matches pg round()). */
private fun BigDecimal.toCents(): Long = setScale(0, RoundingMode.HALF_UP).longValueExact()

/** One line's excl total in cents — identical math to the DB's generated column. */
fun lineExclCents(qty: Double, unitCents: Long, discountPct: Double = 0.0): Long =
    BigDecimal.valueOf(qty)
        .multiply(BigDecimal.valueOf(unitCents))
        .multiply(BigDecimal.ONE.subtract(BigDecimal.valueOf(discountPct).movePointLeft(2)))
        .toCents()

/** pct% of an amount, in cents, rounded half away from zero. */
fun pctOfCents(cents: Long, pct: Int): Long =
    BigDecimal.valueOf(cents).multiply(BigDecimal.valueOf(pct.toLong())).movePointLeft(2).toCents()

fun computeTotals(lines: List<LineInput>): DocTotals {
    val lineTotals = lines.map { l ->
        // line_total_excl = round(qty * unit_price * (1 - disc/100), 2) — in cents.
        val excl = BigDecimal.valueOf(l.qty)
            .multiply(BigDecimal.valueOf(l.unitCents))
            .multiply(BigDecimal.ONE.subtract(BigDecimal.valueOf(l.discountPct).movePointLeft(2)))
            .toCents()
        // line_vat = round(line_total_excl * rate/100, 2) — from the ROUNDED excl.
        val vat = BigDecimal.valueOf(excl)
            .multiply(BigDecimal.valueOf(l.vatRatePct).movePointLeft(2))
            .toCents()
        LineTotals(excl, vat)
    }
    val subtotal = lineTotals.sumOf { it.exclCents }
    val vat = lineTotals.sumOf { it.vatCents }
    return DocTotals(lineTotals, subtotal, vat, subtotal + vat)
}

/** "Rs 32,000.00" — manual formatting for fiscal string determinism (no locale drift). */
fun formatMUR(cents: Long): String {
    val neg = cents < 0
    val abs = if (neg) -cents else cents
    val rupees = abs / 100
    val fraction = abs % 100
    val grouped = rupees.toString().reversed().chunked(3).joinToString(",").reversed()
    return (if (neg) "-Rs " else "Rs ") + grouped + "." + fraction.toString().padStart(2, '0')
}

/** Rupees (DB numeric as Double) → cents. Values are ≤2dp by DB constraint. */
fun rupeesToCents(rupees: Double): Long =
    BigDecimal.valueOf(rupees).movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact()

/** Cents → rupees Double for RPC params (exact: cents/100 is ≤2dp). */
fun centsToRupees(cents: Long): Double =
    BigDecimal.valueOf(cents).movePointLeft(2).toDouble()

/** Parse a numpad string ("1706.5") to cents, null when not a number. */
fun parseMoneyToCents(text: String): Long? {
    val t = text.trim().replace(",", "").replace(" ", "")
    if (t.isEmpty()) return null
    return runCatching { BigDecimal(t).movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact() }.getOrNull()
}
