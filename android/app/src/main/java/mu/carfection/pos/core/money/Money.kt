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
    // True: unitCents IS the VAT-inclusive figure exactly as typed, and the VAT is
    // EXTRACTED (document_lines.price_includes_vat, 20260812000020) — the total lands on
    // the typed number. False: unitCents is net and VAT is added on top (all history).
    val priceInclusive: Boolean = false,
)

data class DocDiscountTotals(
    val lineExclCents: List<Long>,
    // Per-line VAT (pre-order-discount), paired with lineExclCents. A line's own inclusive
    // total is lineExclCents[i] + lineVatCents[i] — which equals grossCents(excl) for a
    // normal line but, for a price_includes_vat line, is the typed figure exactly. The
    // counter's line amount and gross subtotal read it so they never re-gross a cent off.
    val lineVatCents: List<Long>,
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
    // line_total_excl / line_vat — identical CASE to the generated columns, including the
    // price_includes_vat branch (20260812000020): a flagged line's unit IS the typed gross,
    // the net-gross is discounted first, and the VAT is the DIFFERENCE from the extracted
    // excl — so excl + vat sums to the typed figure exactly.
    val inclNetGross = lines.map { l ->
        if (!l.priceInclusive) 0L
        else {
            val grossLine = BigDecimal.valueOf(l.qty).multiply(BigDecimal.valueOf(l.unitCents)).toCents()
            if (l.discountKind == "amount") (grossLine - l.discountAmtInclCents).coerceAtLeast(0L)
            else BigDecimal.valueOf(grossLine)
                .multiply(BigDecimal.ONE.subtract(BigDecimal.valueOf(l.discountPct).movePointLeft(2)))
                .toCents()
        }
    }
    val excl = lines.mapIndexed { i, l ->
        if (l.priceInclusive) {
            BigDecimal.valueOf(inclNetGross[i]).divide(vatFactor(l.vatRatePct), 10, RoundingMode.HALF_UP).toCents()
        } else {
            val gross = BigDecimal.valueOf(l.qty).multiply(BigDecimal.valueOf(l.unitCents))
            val e =
                if (l.discountKind == "amount")
                    gross.subtract(BigDecimal.valueOf(l.discountAmtInclCents).divide(vatFactor(l.vatRatePct), 10, RoundingMode.HALF_UP))
                        .max(BigDecimal.ZERO)
                else
                    gross.multiply(BigDecimal.ONE.subtract(BigDecimal.valueOf(l.discountPct).movePointLeft(2)))
            e.toCents()
        }
    }
    val vat = lines.mapIndexed { i, l ->
        if (l.priceInclusive) inclNetGross[i] - excl[i]
        else BigDecimal.valueOf(excl[i]).multiply(BigDecimal.valueOf(l.vatRatePct).movePointLeft(2)).toCents()
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
        return DocDiscountTotals(excl, vat, 0L, sub, v, sub + v)
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
    return DocDiscountTotals(excl, vat, dIncl, sub, vatSum, sub + vatSum)
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

/**
 * Net → the shelf price the customer actually pays (net + its VAT).
 *
 * DISPLAY ONLY. Prices are stored and charged NET — [computeTotals] adds VAT on top, and the
 * DB's generated columns do the same. Feeding a gross figure back into a total, a cart line,
 * or anything saved would charge the VAT twice. Same arithmetic the receipt already uses.
 */
/**
 * The largest net amount whose grossed-up value does not EXCEED [maxGross] at [vatRatePct].
 *
 * Needed because gross → net → gross is not an identity: `grossCents` skips roughly one integer
 * in eight, so ~13% of gross figures have no net that grosses back to them exactly. Rounding to
 * the nearest lands a cent over the target as often as under, and on a discount "over" means the
 * shop hands back more than the cashier typed. This always errs downward, so a typed discount can
 * come off a cent short but never a cent long, and a discount can never exceed the line it is
 * taken from — which is what stops a bill going negative.
 */
fun netWithinGross(maxGross: Long, vatRatePct: Double): Long {
    if (maxGross <= 0L) return 0L
    var n = netFromGrossCents(maxGross, vatRatePct)
    while (n > 0L && grossCents(n, vatRatePct) > maxGross) n--
    while (grossCents(n + 1L, vatRatePct) <= maxGross) n++
    return n
}

fun grossCents(netCents: Long, vatRatePct: Double): Long {
    // Half AWAY FROM ZERO, like Postgres's round() — Math.round breaks ties toward +∞, which
    // disagrees on negatives, i.e. on every discount line.
    val sign = if (netCents < 0) -1L else 1L
    return netCents + sign * Math.round(Math.abs(netCents) * vatRatePct / 100.0)
}

/** The inverse: a price TYPED as a VAT-inclusive shelf figure → the net to store. */
fun netFromGrossCents(gross: Long, vatRatePct: Double): Long =
    Math.round(gross / (1.0 + vatRatePct / 100.0))

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
