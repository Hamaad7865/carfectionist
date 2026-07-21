package mu.carfection.pos.core.data

import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.money.LineInput
import mu.carfection.pos.core.money.computeTotals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The counter's basket discount, pinned against the bill the customer actually pays.
 *
 * A typed Rs figure is VAT-INCLUSIVE — it is what comes off the total, matching the web's
 * order discount. It used to be emitted as a NET discount line with the DB adding VAT on top,
 * so the bill fell by amount × 1.15 (type 100, give away 115; type 1,400 on a Rs 1,540 bill,
 * bill it at nothing). These cases would all have caught that.
 */
class BasketDiscountTest {

    /** SILVER SUV: shelf Rs 1,540.00, stored net Rs 1,339.13 @ 15%. */
    private fun product(netCents: Long, vat: Double = 15.0, id: String = "p1") =
        ProductEntity(id, "SILVER SUV", "service", netCents, vat, null, false, null, null)

    /** The TOTAL the DB will bill for a spec set — its generated columns add VAT per line. */
    private fun totalOf(specs: List<SaleLineSpec>): Long =
        computeTotals(specs.map { LineInput(it.qty, it.unitCents, it.discountPct, it.vatRatePct) }).totalCents

    @Test
    fun `typed Rs comes off the bill exactly, not plus VAT`() {
        val cart = listOf(CartLine(product(133913), qty = 1.0))
        val undiscounted = totalOf(expandSaleLines(cart))
        assertEquals(154000L, undiscounted) // Rs 1,540.00 shelf

        val specs = expandSaleLines(cart, DiscountMode.AMT, basketAmtCents = 10000)
        assertEquals(154000L - 10000L, totalOf(specs)) // Rs 1,440.00 — exactly Rs 100 off
    }

    @Test
    fun `a discount larger than the bill clamps to the bill, never past zero`() {
        val cart = listOf(CartLine(product(133913), qty = 1.0))
        // Rs 1,400 used to zero a Rs 1,540 bill because it clamped against the NET subtotal.
        assertEquals(14000L, totalOf(expandSaleLines(cart, DiscountMode.AMT, basketAmtCents = 140000)))
        assertEquals(0L, totalOf(expandSaleLines(cart, DiscountMode.AMT, basketAmtCents = 999999)))
    }

    @Test
    fun `a mixed-rate basket still comes off to the cent`() {
        val cart = listOf(
            CartLine(product(133913, 15.0, "p1"), qty = 2.0),
            CartLine(product(50000, 0.0, "p2"), qty = 1.0),
        )
        val before = totalOf(expandSaleLines(cart))
        val after = totalOf(expandSaleLines(cart, DiscountMode.AMT, basketAmtCents = 25000))
        assertEquals(25000L, before - after)
    }

    @Test
    fun `a percentage takes the same proportion off the bill`() {
        val cart = listOf(CartLine(product(133913), qty = 1.0))
        val after = totalOf(expandSaleLines(cart, DiscountMode.PCT, basketPct = 10))
        assertEquals(138600L, after) // 10% off Rs 1,540.00
    }

    // ── the cases the first version of this fix got wrong ────────────────────────────────

    /**
     * gross → net → gross is not an identity: ~13% of gross figures have no net that grosses back
     * to them. The first fix rounded to the NEAREST, so on those the bill fell a cent MORE than the
     * cashier typed (Rs 1,000.00 typed took Rs 1,000.01). Now it snaps down: never more than typed,
     * at worst a cent less. A single spot-check passes either way — this sweeps.
     */
    @Test
    fun `no typed Rs discount ever takes off more than was typed`() {
        val cart = listOf(CartLine(product(133913), qty = 1.0))
        val bill = totalOf(expandSaleLines(cart))
        var short = 0
        for (typed in 1L..bill) {
            val off = bill - totalOf(expandSaleLines(cart, DiscountMode.AMT, basketAmtCents = typed))
            assertTrue("typed $typed took $off — more than asked", off <= typed)
            assertTrue("typed $typed took $off — more than a cent short", off >= typed - 1)
            if (off != typed) short++
        }
        // The unreachable gross figures are a known, bounded cost: a cent, always the shop's way.
        assertTrue("$short of $bill amounts land short", short * 100 / bill <= 15)
    }

    /**
     * The clamp used to gross the SUMMED group net, but the bill is the sum of per-line gross —
     * a cent apart on ~12% of multi-line carts. Discounting the whole bill then overshot it and
     * the total came out at −Rs 0.01, which the payment screen refuses to settle.
     */
    @Test
    fun `comping a multi-line cart lands exactly on zero, never below`() {
        val shelves = listOf(4348L to 5000L, 4783L to 5500L, 133913L to 154000L, 8696L to 10000L)
        for ((i, a) in shelves.withIndex()) for (b in shelves.drop(i)) {
            val cart = listOf(
                CartLine(product(a.first, id = "a"), qty = 1.0),
                CartLine(product(b.first, id = "b"), qty = 1.0),
            )
            val bill = totalOf(expandSaleLines(cart))
            assertEquals("bill for $a + $b", a.second + b.second, bill)
            for (typed in listOf(bill, bill + 1, bill + 100, 999999L)) {
                assertEquals("comp $a + $b at $typed", 0L, totalOf(expandSaleLines(cart, DiscountMode.AMT, basketAmtCents = typed)))
            }
        }
    }

    /** A typed Rs discount on a LINE is what comes off the bill too — it used to take 1.15x. */
    @Test
    fun `a per-line Rs discount comes off the bill exactly`() {
        val cart = listOf(CartLine(product(133913), qty = 1.0, discountMode = DiscountMode.AMT, discountAmtText = "100"))
        assertEquals(154000L - 10000L, totalOf(expandSaleLines(cart)))
    }

    /** A line discount larger than the line cannot make the line, or the bill, negative. */
    @Test
    fun `a per-line Rs discount clamps to the line's shelf price`() {
        val cart = listOf(CartLine(product(133913), qty = 1.0, discountMode = DiscountMode.AMT, discountAmtText = "9999"))
        assertEquals(0L, totalOf(expandSaleLines(cart)))
    }

    /**
     * The footer's Subtotal is summed from the rows on screen and its Discount is the gap to TOTAL,
     * so a row that grosses differently from the way it is billed invents a phantom "−Rs 0.01".
     */
    @Test
    fun `each cart row states exactly what that row adds to the bill`() {
        for (text in listOf("", "1", "0.01", "12.34", "100", "999.99")) {
            for (mode in listOf(DiscountMode.PCT, DiscountMode.AMT)) {
                val l = CartLine(product(133913), qty = 3.0, discountMode = mode, discountPct = 7, discountAmtText = text)
                assertEquals("row for $mode '$text'", totalOf(expandSaleLines(listOf(l))), l.rowGrossCents)
            }
        }
    }
}
