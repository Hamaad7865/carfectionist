package mu.carfection.pos.feature.counter

import mu.carfection.pos.core.data.CartLine
import mu.carfection.pos.core.data.DiscountMode
import mu.carfection.pos.core.data.SaleIssueUncertain
import mu.carfection.pos.core.data.SalePaymentUncertain
import mu.carfection.pos.core.database.ProductEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * Once a settle reaches `issue_document` the server may hold an invoice under this sale's
 * idempotency key, and both money RPCs replay purely on that key. Settling a different basket
 * under it would charge the customer for the old one, so the basket must freeze until the
 * attempt resolves. Anything that failed *before* the invoice exists must stay editable.
 */
class SettleLockTest {

    private fun product(id: String, priceCents: Long) = ProductEntity(
        id = id, name = "Part $id", kind = "product", sellingPriceCents = priceCents,
        vatRatePct = 15.0, barcode = null, isStocked = true, category = null, lowStockThreshold = null,
    )

    private val brakePad = product("p1", 1_000_00)
    private val wiper = product("p2", 200_00)

    /** Cart A: one Rs 1,000 line, 10% off the basket — the ticket the cashier tried to settle. */
    private fun cartA(): CounterUiState =
        CounterUiState(basketMode = DiscountMode.PCT, basketText = "10")
            .withCart(listOf(CartLine(brakePad, 1.0)))

    private val wifiDrop = IOException("Unable to resolve host")

    // ── the invoice exists: payment failed after issue ────────────────────────

    @Test
    fun `a failed payment freezes the basket`() {
        val failed = cartA().withSettleFailure(SalePaymentUncertain("inv-1", "INV-0007", wifiDrop))

        val edited = failed.withCart(listOf(CartLine(brakePad, 1.0), CartLine(wiper, 1.0)))

        assertEquals("the cart may not change", failed.cart, edited.cart)
        assertEquals(SETTLE_LOCK_NOTICE, edited.notice)
    }

    @Test
    fun `a failed payment freezes the whole-sale discount too`() {
        val failed = cartA().withSettleFailure(SalePaymentUncertain("inv-1", "INV-0007", wifiDrop))

        val rediscounted = failed.withBasket(DiscountMode.AMT, "500")

        assertEquals(DiscountMode.PCT, rediscounted.basketMode)
        assertEquals("10", rediscounted.basketText)
        assertEquals(SETTLE_LOCK_NOTICE, rediscounted.notice)
    }

    /** The payment may in fact have committed, so the cashier must be steered to retry, not cancel. */
    @Test
    fun `a failed payment names the invoice and steers the cashier to retry`() {
        val failed = cartA().withSettleFailure(SalePaymentUncertain("inv-1", "INV-0007", wifiDrop))

        assertEquals(PendingSettle("inv-1", "INV-0007"), failed.pendingSettle)
        assertTrue(failed.error!!.contains("INV-0007"))
        assertTrue(failed.error!!.contains("never charge twice"))
    }

    /** Retrying re-sends the identical basket, which is exactly what the server replay needs. */
    @Test
    fun `a failed payment leaves the basket intact for an identical retry`() {
        val before = cartA()
        val failed = before.withSettleFailure(SalePaymentUncertain("inv-1", "INV-0007", wifiDrop))

        assertEquals(before.cart, failed.cart)
        assertEquals(before.specs, failed.specs)
        assertEquals(before.totals, failed.totals)
        assertEquals(false, failed.busy)
    }

    // ── the invoice may exist: issue itself failed ────────────────────────────

    @Test
    fun `an uncertain issue freezes the basket, with no invoice to name`() {
        val failed = cartA().withSettleFailure(SaleIssueUncertain(wifiDrop))

        assertNotNull(failed.pendingSettle)
        assertNull(failed.pendingSettle!!.invoiceId)
        assertTrue(failed.error!!.contains("don't change the basket"))

        val edited = failed.withCart(emptyList())
        assertEquals(failed.cart, edited.cart)
        assertEquals(SETTLE_LOCK_NOTICE, edited.notice)
    }

    // ── nothing was issued: the cashier keeps working ─────────────────────────

    @Test
    fun `a failure before the invoice exists leaves the basket editable`() {
        // saveDraft / customer resolution / an offline tap: no number drawn, no stock moved.
        val failed = cartA().withSettleFailure(IOException("Unable to resolve host"))

        assertNull(failed.pendingSettle)
        assertEquals("Unable to resolve host", failed.error)

        val edited = failed.withCart(listOf(CartLine(brakePad, 1.0), CartLine(wiper, 1.0)))
        assertEquals(2, edited.cart.size)
        assertNull(edited.notice)
    }

    @Test
    fun `a fresh ticket carries no settle lock`() {
        assertNull(CounterUiState().pendingSettle)
    }

    /** newSale() rebuilds the state from defaults, so cancelling a frozen sale always thaws it. */
    @Test
    fun `a frozen sale does not survive into the next ticket`() {
        val frozen = cartA().withSettleFailure(SalePaymentUncertain("inv-1", "INV-0007", wifiDrop))
        assertNotNull(frozen.pendingSettle)

        val next = CounterUiState(till = frozen.till, mode = frozen.mode) // what newSale() builds
        assertNull(next.pendingSettle)
        assertEquals(1, next.withCart(listOf(CartLine(wiper, 1.0))).cart.size)
    }

    /** The bug this fixes: cart B must never be built on top of cart A's issued invoice. */
    @Test
    fun `the reported mischarge is unreachable — cart B cannot be built over cart A's invoice`() {
        val cartB = cartA()
            .withSettleFailure(SalePaymentUncertain("inv-1", "INV-0007", wifiDrop))
            .withCart(listOf(CartLine(wiper, 3.0))) // cashier tries to swap the basket
            .withBasket(DiscountMode.AMT, "0") // ...and drop the discount

        assertEquals(listOf(CartLine(brakePad, 1.0)), cartB.cart)
        assertEquals(1_035_00L, cartB.totals.totalCents) // still cart A's price, unchanged
    }
}
