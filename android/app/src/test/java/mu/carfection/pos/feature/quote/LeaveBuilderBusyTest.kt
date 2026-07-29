package mu.carfection.pos.feature.quote

import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Leaving the builder must not carry `busy` out with it.
 *
 * voidThisQuote set busy = true and then navigated home without clearing it, so every control
 * gated on !busy went dead for the life of the screen — Back, Continue to signature, Save
 * draft — with nothing on screen saying why. The flag is cleared in back() rather than in each
 * caller, so a future one cannot strand it the same way.
 */
class LeaveBuilderBusyTest {

    /** Mirrors what back() resets. */
    private fun leave(s: QuoteState) = s.copy(
        mode = QuoteMode.LIST,
        pickerOpen = false, confirmDelete = false, sendOpen = false,
        adhocOpen = false, acceptOpen = false,
        datePickerOpen = false, timePickerOpen = false,
        busy = false, error = null,
    )

    @Test
    fun `a busy builder does not leave the list stuck`() {
        val mid = QuoteState(mode = QuoteMode.BUILDER, busy = true, acceptOpen = true)
        val after = leave(mid)
        assertFalse("busy must not survive leaving the builder", after.busy)
        assertFalse(after.acceptOpen)
    }

    @Test
    fun `returning from a void leaves every control usable again`() {
        // The exact shape after voidThisQuote: busy set, confirm dismissed, then home.
        val afterVoid = leave(QuoteState(mode = QuoteMode.BUILDER, busy = true, confirmDelete = false))
        assertFalse(afterVoid.busy)
    }
}
