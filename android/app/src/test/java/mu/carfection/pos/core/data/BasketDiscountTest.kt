package mu.carfection.pos.core.data

import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.money.LineInput
import mu.carfection.pos.core.money.computeTotals
import org.junit.Assert.assertEquals
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
}
