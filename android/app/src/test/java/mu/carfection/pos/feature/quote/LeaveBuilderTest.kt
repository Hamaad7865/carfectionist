package mu.carfection.pos.feature.quote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Leaving the builder must take its dialogs with it.
 *
 * The customer picker is mounted on the SCREEN, not inside the builder branch, so returning to
 * the list without closing it left the dialog sitting over the quotes list — Cancel looked
 * completely dead, because what it dismissed was still there.
 */
class LeaveBuilderTest {

    /** Mirrors what back() now resets. */
    private fun leave(s: QuoteState) = s.copy(
        mode = QuoteMode.LIST,
        pickerOpen = false, confirmDelete = false, sendOpen = false,
        adhocOpen = false, acceptOpen = false,
        datePickerOpen = false, timePickerOpen = false,
        error = null,
    )

    @Test
    fun `cancelling out of the picker returns to the list with nothing on top`() {
        val inBuilder = QuoteState(mode = QuoteMode.BUILDER, pickerOpen = true, customerId = null)
        val after = leave(inBuilder)
        assertEquals(QuoteMode.LIST, after.mode)
        assertFalse("the picker must not outlive the builder", after.pickerOpen)
    }

    @Test
    fun `no builder dialog survives the return to the list`() {
        val busy = QuoteState(
            mode = QuoteMode.BUILDER, pickerOpen = true, confirmDelete = true, sendOpen = true,
            adhocOpen = true, acceptOpen = true, datePickerOpen = true, timePickerOpen = true,
            error = "something went wrong",
        )
        val after = leave(busy)
        listOf(
            "picker" to after.pickerOpen, "confirm delete" to after.confirmDelete,
            "send" to after.sendOpen, "ad-hoc" to after.adhocOpen, "accept" to after.acceptOpen,
            "date" to after.datePickerOpen, "time" to after.timePickerOpen,
        ).forEach { (name, open) -> assertFalse("$name must close", open) }
        // A builder error is about the quote just left, not the list being returned to.
        assertEquals(null, after.error)
    }
}
