package mu.carfection.pos.core.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import mu.carfection.pos.ui.PosTab

/**
 * A tablet that never charges anyone must not be asked to open a till. The role
 * comes back on register_device; everything here is the decision it drives.
 *
 * The default matters more than it looks: a real till that has never reached the
 * server, or is offline on first launch, must still be able to sell. Unknown
 * therefore means "takes payments" — failing safe means failing toward selling.
 */
class DeviceRoleTest {

    private fun row(json: String): JsonObject = Json.parseToJsonElement(json) as JsonObject

    @Test
    fun `reads the flag off the device row`() {
        assertTrue(takesPaymentsOf(row("""{"device_code":"TAB-1","takes_payments":true}""")))
        assertFalse(takesPaymentsOf(row("""{"device_code":"TAB-1","takes_payments":false}""")))
    }

    @Test
    fun `anything unreadable means the device takes payments`() {
        assertTrue("no row at all", takesPaymentsOf(null))
        assertTrue("column absent (older server)", takesPaymentsOf(row("""{"device_code":"TAB-1"}""")))
        assertTrue("null value", takesPaymentsOf(row("""{"takes_payments":null}""")))
        assertTrue("wrong type", takesPaymentsOf(row("""{"takes_payments":{"a":1}}""")))
    }

    @Test
    fun `a quotation device has no Checkout tab`() {
        assertTrue("a till keeps every tab", visibleTabs(true) == PosTab.entries.toList())
        assertFalse("Checkout is gone", visibleTabs(false).contains(PosTab.SALE))
        assertEquals("nothing else is lost", PosTab.entries.size - 1, visibleTabs(false).size)
    }

    @Test
    fun `a quotation device lands on Intake`() {
        assertEquals(PosTab.SALE, landingTab(true))
        assertEquals(PosTab.INTAKE, landingTab(false))
    }

    @Test
    fun `a live switch moves an operator off Checkout, and leaves them alone otherwise`() {
        assertEquals("sitting on Checkout when the switch flips", PosTab.INTAKE, tabAfterRoleChange(PosTab.SALE, false))
        assertEquals("sitting elsewhere — do not yank them", PosTab.JOBS, tabAfterRoleChange(PosTab.JOBS, false))
        assertEquals("a till is never moved", PosTab.SALE, tabAfterRoleChange(PosTab.SALE, true))
    }
}
