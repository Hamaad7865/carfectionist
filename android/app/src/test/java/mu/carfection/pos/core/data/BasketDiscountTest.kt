package mu.carfection.pos.core.data

import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.money.computeDocTotals
import mu.carfection.pos.core.money.pctOfCents
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The counter's discounts, pinned against the bill the DB will actually store.
 *
 * Discounts ride the schema's own columns. The counter used to synthesise NEGATIVE "Discount"
 * rows instead, which the live DB has rejected outright since 2026-07-15
 * (document_lines_unit_price_nonneg) — so every discounted sale failed to save, and the elaborate
 * client-side apportionment those rows needed was arithmetic nobody could ever have banked.
 * `no discount is ever emitted as a negative price` is the regression guard for that.
 */
class BasketDiscountTest {

    /** SILVER SUV: shelf Rs 1,540.00, stored net Rs 1,339.13 @ 15%. */
    private fun product(netCents: Long, vat: Double = 15.0, id: String = "p1") =
        ProductEntity(id, "SILVER SUV", "service", netCents, vat, null, false, null, null)

    /** The TOTAL the DB will bill for a cart — computeDocTotals mirrors app.discounted_vat_groups. */
    private fun totalOf(cart: List<CartLine>, mode: DiscountMode = DiscountMode.PCT, pct: Int = 0, amt: Long = 0L): Long {
        val d = expandSaleLines(cart, mode, pct, amt)
        return computeDocTotals(cart.map { it.docLine }, d.orderDiscountKind, pct.toDouble(), amt).totalCents
    }

    private fun cart(vararg nets: Long) = nets.mapIndexed { i, n -> CartLine(product(n, id = "p$i"), qty = 1.0) }

    // ── the constraint that made every discounted sale fail ──────────────────────────────

    /**
     * The DB refuses unit_price < 0. Nothing the counter emits may ever carry one again — not a
     * line, not a basket discount, not a full comp.
     */
    @Test
    fun `no discount is ever emitted as a negative price`() {
        val c = listOf(
            CartLine(product(133913, id = "a"), qty = 2.0, discountMode = DiscountMode.AMT, discountAmtText = "250"),
            CartLine(product(4783, id = "b"), qty = 1.0, discountPct = 30),
        )
        for (mode in listOf(DiscountMode.PCT, DiscountMode.AMT)) {
            for (v in listOf(0L, 1L, 55L, 10000L, 999999L)) {
                val d = expandSaleLines(c, mode, basketPct = v.toInt().coerceIn(0, 100), basketAmtCents = v)
                d.specs.forEach {
                    assertTrue("negative unit price emitted: $it", it.unitCents >= 0)
                    assertTrue("negative discount emitted: $it", it.discountAmountInclCents >= 0)
                }
                // A discount is never a phantom item row either — one spec per cart line, always.
                assertEquals("spec count for $mode $v", c.size, d.specs.size)
            }
        }
    }

    // ── what the discounts actually take off ─────────────────────────────────────────────

    @Test
    fun `typed Rs comes off the bill exactly, not plus VAT`() {
        assertEquals(154000L, totalOf(cart(133913)))                                     // Rs 1,540.00 shelf
        assertEquals(154000L - 10000L, totalOf(cart(133913), DiscountMode.AMT, amt = 10000))
    }

    @Test
    fun `a discount larger than the bill clamps to the bill, never past zero`() {
        assertEquals(14000L, totalOf(cart(133913), DiscountMode.AMT, amt = 140000))
        assertEquals(0L, totalOf(cart(133913), DiscountMode.AMT, amt = 999999))
    }

    @Test
    fun `a percentage takes the same proportion off the bill`() {
        assertEquals(138600L, totalOf(cart(133913), DiscountMode.PCT, pct = 10)) // 10% off Rs 1,540.00
    }

    /**
     * The old scheme took the percentage off the NET subtotal while the DB takes it off the GROSS,
     * so the tablet and the web charged different figures for the same basket. Both are the DB's
     * formula now: TOTAL = gross − pct% of gross.
     */
    @Test
    fun `a percentage matches the DB's formula on every real catalogue price`() {
        val nets = listOf(11957L, 15217L, 17391L, 19130L, 28696L, 32609L, 133913L)
        for (n in nets) for (qty in 1..3) for (p in 0..100) {
            val c = listOf(CartLine(product(n), qty = qty.toDouble()))
            val gross = totalOf(c)
            assertEquals("net $n x$qty @$p%", gross - pctOfCents(gross, p), totalOf(c, DiscountMode.PCT, pct = p))
        }
    }

    /**
     * The typed figure is now EXACT. The previous two-row scheme could only land within a cent
     * (13% of amounts were short) because it had to convert gross→net itself; the DB divides by
     * (1 + rate/100) directly, so there is no conversion left to round.
     */
    @Test
    fun `every typed Rs discount comes off to the exact cent`() {
        val c = cart(133913)
        val bill = totalOf(c)
        for (typed in 1L..bill) {
            assertEquals("typed $typed", bill - typed, totalOf(c, DiscountMode.AMT, amt = typed))
        }
    }

    @Test
    fun `comping a multi-line cart lands exactly on zero, never below`() {
        val shelves = listOf(4348L, 4783L, 133913L, 8696L)
        for ((i, a) in shelves.withIndex()) for (b in shelves.drop(i)) {
            val c = listOf(CartLine(product(a, id = "a"), 1.0), CartLine(product(b, id = "b"), 1.0))
            val bill = totalOf(c)
            for (typed in listOf(bill, bill + 1, bill + 100, 999999L)) {
                assertEquals("comp $a + $b at $typed", 0L, totalOf(c, DiscountMode.AMT, amt = typed))
            }
            assertEquals("100% off $a + $b", 0L, totalOf(c, DiscountMode.PCT, pct = 100))
        }
    }

    // ── per-line discounts ───────────────────────────────────────────────────────────────

    /** A typed Rs discount on a LINE is what comes off the bill too — it used to take 1.15x. */
    @Test
    fun `a per-line Rs discount comes off the bill exactly`() {
        val c = listOf(CartLine(product(133913), 1.0, DiscountMode.AMT, discountAmtText = "100"))
        assertEquals(154000L - 10000L, totalOf(c))
    }

    @Test
    fun `a per-line Rs discount clamps to the line's shelf price`() {
        val c = listOf(CartLine(product(133913), 1.0, DiscountMode.AMT, discountAmtText = "9999"))
        assertEquals(0L, totalOf(c))
    }

    /** Line discount and basket discount compose the way the DB composes them. */
    @Test
    fun `a basket discount stacks on top of a per-line one`() {
        val c = listOf(CartLine(product(133913), 1.0, DiscountMode.AMT, discountAmtText = "100"))
        assertEquals(144000L, totalOf(c))                                   // Rs 1,540 − Rs 100
        assertEquals(129600L, totalOf(c, DiscountMode.PCT, pct = 10))       // then 10% off that
        assertEquals(72000L, totalOf(c, DiscountMode.PCT, pct = 50))
        assertEquals(0L, totalOf(c, DiscountMode.PCT, pct = 100))
    }

    /**
     * Checked against the LIVE database, not just against ourselves: these exact rows were
     * inserted through app.recompute_doc_totals in a rolled-back transaction and Postgres returned
     * subtotal_excl 1700.00 / vat 255.00 / total_incl 1955.00. If this ever fails, the client and
     * the server have drifted apart again — which is how the whole discount path went wrong.
     */
    @Test
    fun `matches what Postgres actually stored for a mixed line and basket discount`() {
        val c = listOf(
            CartLine(product(62174, id = "a"), 1.0),                                          // Rs 715.00
            CartLine(product(133913, id = "b"), 1.0, DiscountMode.AMT, discountAmtText = "100"), // Rs 1,540 − 100
        )
        val d = computeDocTotals(c.map { it.docLine }, "amount", 0.0, 20000) // Rs 200 off the basket
        assertEquals(170000L, d.subtotalCents)
        assertEquals(25500L, d.vatCents)
        assertEquals(195500L, d.totalCents)
    }

    /**
     * The footer sums the rows on screen, so a row must state exactly what it adds to the bill or
     * the footer invents a phantom "Discount −Rs 0.01".
     */
    @Test
    fun `each cart row states exactly what that row adds to the bill`() {
        for (text in listOf("", "1", "0.01", "12.34", "100", "999.99")) {
            for (mode in listOf(DiscountMode.PCT, DiscountMode.AMT)) {
                val l = CartLine(product(133913), 3.0, mode, discountPct = 7, discountAmtText = text)
                val d = computeDocTotals(listOf(l.docLine), null, 0.0, 0)
                assertEquals("row for $mode '$text'", totalOf(listOf(l)), d.totalCents)
            }
        }
    }
}
