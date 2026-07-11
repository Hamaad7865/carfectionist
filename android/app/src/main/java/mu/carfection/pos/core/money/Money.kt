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

// ── Document totals with the discount module's semantics (quote builder) ──────
// Mirrors document_lines' generated columns + app.discounted_vat_groups():
// Rs discounts are VAT-INCLUSIVE (staff think in inclusive prices); the ledger
// stores ex-VAT, so an amount comes off as amount/(1+rate/100). The order
// discount is apportioned across VAT-rate groups by inclusive share with the
// largest group absorbing the rounding remainder — exactly the DB's algorithm,
// so the footer always shows what the server will store.

/** One builder line as the DB will price it. */
data class DocLineIn(
    val qty: Double,
    val unitCents: Long,
    val discountKind: String, // "percent" | "amount"
    val discountPct: Double,
    val discountAmtInclCents: Long, // VAT-inclusive Rs off
    val vatRatePct: Double,
)

data class DocDiscountTotals(
    val lineExclCents: List<Long>,
    val orderDiscountInclCents: Long, // what the order discount actually takes off (incl)
    val subtotalCents: Long,
    val vatCents: Long,
    val totalCents: Long,
)

private fun vatFactor(ratePct: Double): BigDecimal =
    BigDecimal.ONE.add(BigDecimal.valueOf(ratePct).movePointLeft(2))

fun computeDocTotals(
    lines: List<DocLineIn>,
    orderKind: String?, // null | "percent" | "amount"
    orderPct: Double,
    orderAmtInclCents: Long,
): DocDiscountTotals {
    // line_total_excl / line_vat — identical CASE to the generated columns.
    val excl = lines.map { l ->
        val gross = BigDecimal.valueOf(l.qty).multiply(BigDecimal.valueOf(l.unitCents))
        val e =
            if (l.discountKind == "amount")
                gross.subtract(BigDecimal.valueOf(l.discountAmtInclCents).divide(vatFactor(l.vatRatePct), 10, RoundingMode.HALF_UP))
                    .max(BigDecimal.ZERO)
            else
                gross.multiply(BigDecimal.ONE.subtract(BigDecimal.valueOf(l.discountPct).movePointLeft(2)))
        e.toCents()
    }
    val vat = lines.mapIndexed { i, l ->
        BigDecimal.valueOf(excl[i]).multiply(BigDecimal.valueOf(l.vatRatePct).movePointLeft(2)).toCents()
    }

    // Per-VAT-rate groups (base, vat, incl) — the discounted_vat_groups input.
    data class Group(val rate: Double, val base0: Long, val vat0: Long) { val incl get() = base0 + vat0 }
    val groups = lines.indices.groupBy { lines[it].vatRatePct }
        .map { (rate, idx) -> Group(rate, idx.sumOf { excl[it] }, idx.sumOf { vat[it] }) }
    val gross = groups.sumOf { it.incl }

    val dIncl = when {
        orderKind == null || gross <= 0 -> 0L
        orderKind == "percent" ->
            if (orderPct <= 0.0) 0L
            else BigDecimal.valueOf(gross).multiply(BigDecimal.valueOf(orderPct).movePointLeft(2)).toCents()
        else -> orderAmtInclCents.coerceIn(0L, gross)
    }
    if (dIncl == 0L) {
        val sub = groups.sumOf { it.base0 }
        val v = groups.sumOf { it.vat0 }
        return DocDiscountTotals(excl, 0L, sub, v, sub + v)
    }

    // d_raw = round(d_incl × incl_g / gross); the largest-incl group (tie → lower
    // rate, matching ORDER BY incl DESC, rate) absorbs the rounding remainder.
    val dRaw = groups.map { g ->
        BigDecimal.valueOf(dIncl).multiply(BigDecimal.valueOf(g.incl))
            .divide(BigDecimal.valueOf(gross), 0, RoundingMode.HALF_UP).longValueExact()
    }
    val topIdx = groups.indices.sortedWith(compareByDescending<Int> { groups[it].incl }.thenBy { groups[it].rate }).first()
    var sub = 0L
    var vatSum = 0L
    groups.forEachIndexed { i, g ->
        val dG = dRaw[i] + if (i == topIdx) dIncl - dRaw.sum() else 0L
        val net = g.incl - dG
        val base = BigDecimal.valueOf(net).divide(vatFactor(g.rate), 0, RoundingMode.HALF_UP).longValueExact()
        sub += base
        vatSum += net - base
    }
    return DocDiscountTotals(excl, dIncl, sub, vatSum, sub + vatSum)
}

/** Cents → a plain editable text ("6886.96") for price/discount input fields. */
fun centsToPlainText(cents: Long): String =
    BigDecimal.valueOf(cents).movePointLeft(2).toPlainString()

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
