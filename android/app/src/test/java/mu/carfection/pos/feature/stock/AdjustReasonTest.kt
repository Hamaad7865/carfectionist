package mu.carfection.pos.feature.stock

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A stock movement must say WHY.
 *
 * The ± buttons used to post immediately with the note "Quick +1", which recorded that stock
 * moved but not the reason — so neither the ledger nor the printed log could answer the only
 * question worth asking of an adjustment. Every path now goes through the dialog, and the
 * dialog will not commit without a chosen reason.
 */
class AdjustReasonTest {

    @Test
    fun `a fresh adjustment has no reason preselected`() {
        // Defaulting to "Received stock" is how a WRONG reason gets recorded by accident:
        // staff tap Apply and the ledger then confidently states something nobody chose.
        assertTrue(AdjustState("p1", "S40 350", 4).reason.isBlank())
    }

    @Test
    fun `a quantity alone cannot be applied`() {
        assertFalse(AdjustState("p1", "S40 350", 4, delta = -1).canApply)
    }

    @Test
    fun `a reason alone cannot be applied`() {
        assertFalse(AdjustState("p1", "S40 350", 4, delta = 0, reason = "Damaged").canApply)
    }

    @Test
    fun `a quantity AND a reason can be applied`() {
        assertTrue(AdjustState("p1", "S40 350", 4, delta = -1, reason = "Damaged").canApply)
    }

    @Test
    fun `whitespace is not a reason`() {
        assertFalse(AdjustState("p1", "S40 350", 4, delta = -1, reason = "   ").canApply)
    }

    @Test
    fun `every offered reason actually says why stock moved`() {
        // Guards against a future "Quick"/"Other"/"Adjustment" chip creeping back in — a chip
        // carrying no information would defeat the point of requiring one at all.
        assertTrue(STOCK_REASONS.isNotEmpty())
        STOCK_REASONS.forEach {
            assertTrue("vague reason offered: $it", it.length >= 6)
            assertFalse(
                "meaningless reason offered: $it",
                it.equals("quick", true) || it.equals("other", true) || it.equals("adjustment", true),
            )
        }
    }

    @Test
    fun `on-hand never goes negative through the dialog`() {
        assertTrue(AdjustState("p1", "S40 350", 1, delta = -5, reason = "Damaged").result == 0)
    }
}
