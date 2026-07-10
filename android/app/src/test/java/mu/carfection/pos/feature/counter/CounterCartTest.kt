package mu.carfection.pos.feature.counter

import mu.carfection.pos.core.data.CartLine
import mu.carfection.pos.core.data.DiscountMode
import mu.carfection.pos.core.database.ProductEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The counter's discount state must live and die with the ticket. A discount typed for one
 * customer may never price the next customer's basket — that under-charges silently.
 */
class CounterCartTest {

    private fun product(id: String, priceCents: Long) = ProductEntity(
        id = id, name = "Part $id", kind = "product", sellingPriceCents = priceCents,
        vatRatePct = 15.0, barcode = null, isStocked = true, category = null, lowStockThreshold = null,
    )

    private val brakePad = product("p1", 1_000_00)

    /** A ticket with one Rs 1,000 line and 10% off the whole basket. */
    private fun tenPctOffOneLine(): CounterUiState =
        CounterUiState(basketMode = DiscountMode.PCT, basketText = "10")
            .withCart(listOf(CartLine(brakePad, 1.0)))

    private fun basketLines(s: CounterUiState) = s.specs.filter { it.title.startsWith("Basket discount") }

    @Test
    fun `a basket discount prices the ticket it was typed for`() {
        val s = tenPctOffOneLine()
        assertEquals(100_00L, s.basketAppliedCents)
        assertEquals(900_00L, s.totals.subtotalCents) // 1,000 − 10%
        assertEquals(135_00L, s.totals.vatCents)
        assertEquals(1_035_00L, s.totals.totalCents)
    }

    @Test
    fun `emptying the cart clears the basket discount`() {
        val emptied = tenPctOffOneLine().withCart(emptyList())

        assertEquals("", emptied.basketText)
        assertEquals(DiscountMode.PCT, emptied.basketMode)
    }

    @Test
    fun `the ticket built after an emptied cart is charged in full`() {
        val next = tenPctOffOneLine()
            .withCart(emptyList()) // cashier ✕'d the last line
            .withCart(listOf(CartLine(brakePad, 1.0))) // next walk-in

        assertTrue("no basket discount line may survive", basketLines(next).isEmpty())
        assertEquals(0L, next.basketAppliedCents)
        assertEquals(1_150_00L, next.totals.totalCents) // 1,000 + 15% VAT, undiscounted
    }

    @Test
    fun `an Rs basket discount also clears when the cart empties`() {
        val emptied = CounterUiState(basketMode = DiscountMode.AMT, basketText = "500")
            .withCart(listOf(CartLine(brakePad, 1.0)))
            .withCart(emptyList())

        assertEquals("", emptied.basketText)
        assertEquals(0L, emptied.basketAmtCents)
    }

    /** Typing the discount before scanning is a normal flow — only a *transition* to empty clears. */
    @Test
    fun `a discount typed on an empty cart still applies to the first line added`() {
        val s = CounterUiState(basketMode = DiscountMode.PCT, basketText = "10")
            .withCart(emptyList()) // still empty — nothing to end
            .withCart(listOf(CartLine(brakePad, 1.0)))

        assertEquals("10", s.basketText)
        assertEquals(100_00L, s.basketAppliedCents)
    }

    /** Removing one line of several is an edit, not the end of the ticket. */
    @Test
    fun `a basket discount survives removing one of two lines`() {
        val wiper = product("p2", 200_00)
        val s = CounterUiState(basketMode = DiscountMode.PCT, basketText = "10")
            .withCart(listOf(CartLine(brakePad, 1.0), CartLine(wiper, 1.0)))
            .withCart(listOf(CartLine(brakePad, 1.0)))

        assertEquals("10", s.basketText)
        assertEquals(100_00L, s.basketAppliedCents) // 10% of the remaining Rs 1,000 line
    }

    /** Line discounts are already cart-scoped: a removed line takes its discount with it. */
    @Test
    fun `a line discount does not survive removing and re-adding the product`() {
        val discounted = CounterUiState()
            .withCart(listOf(CartLine(brakePad, 1.0, discountPct = 20)))
        assertEquals(800_00L, discounted.totals.subtotalCents)

        val reAdded = discounted
            .withCart(emptyList())
            .withCart(listOf(CartLine(brakePad, 1.0))) // add() builds a fresh line

        assertEquals(1_000_00L, reAdded.totals.subtotalCents)
    }
}
