package mu.carfection.pos.feature.quote

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * When a latched bill-on-open may fire, and when a goods bill may wait.
 *
 * The latch armed by the jobs board is for ONE quote, but its lines arrive later. The
 * flag used to survive a lines-load failure and fire on whatever quote was opened next —
 * billing a customer for somebody else's price. The armed quote id now travels with the
 * flag, and all three have to hold: armed, loaded, and still the same quote.
 *
 * Goods have no job to carry their billing, so accepting them always issued the bill on
 * the spot — including phone orders with nobody at the till. A goods quote accepted for
 * later now waits as a draft until collection instead.
 */
class PendingBillLatchTest {

    @Test
    fun `an armed latch fires once its own quote's lines are in`() {
        assertTrue(shouldFirePendingBill(pendingArmed = true, armedQuoteId = "q1", openQuoteId = "q1", linesLoaded = true))
    }

    @Test
    fun `the latch waits for the lines - billing before they arrive invoices unread prices`() {
        assertFalse(shouldFirePendingBill(pendingArmed = true, armedQuoteId = "q1", openQuoteId = "q1", linesLoaded = false))
    }

    @Test
    fun `a disarmed latch never fires`() {
        assertFalse(shouldFirePendingBill(pendingArmed = false, armedQuoteId = "q1", openQuoteId = "q1", linesLoaded = true))
    }

    @Test
    fun `the latch does not follow onto the next opened quote`() {
        assertFalse(shouldFirePendingBill(pendingArmed = true, armedQuoteId = "q1", openQuoteId = "q2", linesLoaded = true))
    }

    @Test
    fun `a latch with no armed quote never fires`() {
        assertFalse(shouldFirePendingBill(pendingArmed = true, armedQuoteId = null, openQuoteId = "q1", linesLoaded = true))
    }

    @Test
    fun `goods accepted for later wait as a draft`() {
        assertTrue(shouldDeferGoodsBill(hasService = false, startJobNow = false))
    }

    @Test
    fun `work starting now is not deferred - the job carries the billing`() {
        assertFalse(shouldDeferGoodsBill(hasService = true, startJobNow = true))
    }

    @Test
    fun `a service quote accepted for later is not a goods bill`() {
        assertFalse(shouldDeferGoodsBill(hasService = true, startJobNow = false))
    }
}
