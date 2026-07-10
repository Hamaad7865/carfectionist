package mu.carfection.pos.feature.counter

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The counter sale deducts the Shop, so the warning must read the Shop — a product
 * with an empty shelf and a full warehouse has to prompt, not sail through.
 */
class CounterOversellTest {

    @Test
    fun `an empty shelf prompts even when the warehouse is full`() {
        assertTrue(needsOversellPrompt(isStocked = true, alreadyConfirmed = false, shopQty = 0, targetQty = 1.0))
    }

    @Test
    fun `stock on the shelf does not prompt`() {
        assertFalse(needsOversellPrompt(isStocked = true, alreadyConfirmed = false, shopQty = 69, targetQty = 1.0))
    }

    @Test
    fun `prompts once the quantity outruns the shelf`() {
        assertFalse(needsOversellPrompt(isStocked = true, alreadyConfirmed = false, shopQty = 2, targetQty = 2.0))
        assertTrue(needsOversellPrompt(isStocked = true, alreadyConfirmed = false, shopQty = 2, targetQty = 3.0))
    }

    @Test
    fun `already negative shop stock still prompts`() {
        assertTrue(needsOversellPrompt(isStocked = true, alreadyConfirmed = false, shopQty = -2, targetQty = 1.0))
    }

    @Test
    fun `services and ad-hoc lines never prompt`() {
        assertFalse(needsOversellPrompt(isStocked = false, alreadyConfirmed = false, shopQty = 0, targetQty = 5.0))
    }

    @Test
    fun `the cashier is asked once per product per sale`() {
        assertFalse(needsOversellPrompt(isStocked = true, alreadyConfirmed = true, shopQty = 0, targetQty = 3.0))
    }

    @Test
    fun `warehouse stock reads as a transfer, not a stock-out`() {
        assertEquals("277 in the warehouse — transfer or continue", warehouseHint(277))
    }

    @Test
    fun `an empty warehouse reads as a true stock-out`() {
        assertEquals("none in the warehouse either", warehouseHint(0))
        assertEquals("none in the warehouse either", warehouseHint(-3))
    }
}
