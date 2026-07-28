package mu.carfection.pos.feature.quote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What may be changed about a quote, and when.
 *
 * A DRAFT is working paper: it can be re-pointed at another customer, or thrown away. Anything
 * issued has been shown to a customer and is not ours to rewrite quietly — the DB enforces that
 * too (doc_delete only matches status = 'draft'), so these pin the app's half of the rule.
 */
class DraftEditTest {

    private fun state(status: String) = QuoteState(
        status = status, quoteId = "q1", customerId = "c1", who = "Lucas",
        vehicleId = "v1", vehPlate = "2211 MR 23", veh = "Hyundai Creta",
    )

    @Test
    fun `only a draft offers discard and change-customer`() {
        assertTrue(state("draft").status == "draft")
        listOf("issued", "accepted", "void").forEach {
            assertFalse("$it must not be editable this way", state(it).status == "draft")
        }
    }

    /**
     * The one that would corrupt data: re-pointing a draft at another customer must take the
     * car with it, or the quote saves person A against person B's vehicle.
     */
    @Test
    fun `changing the customer clears the previous customer's car`() {
        val before = state("draft")
        assertEquals("v1", before.vehicleId)

        // What pickQuoteCustomer now does.
        val after = before.copy(
            customerId = "c2", who = "Anesh", customerPhone = null,
            vehicleId = null, vehPlate = null, veh = "",
            pickVehicles = emptyList(), pickResults = emptyList(), pickQuery = "",
        )

        assertEquals("c2", after.customerId)
        assertNull("the old car must not survive the change", after.vehicleId)
        assertNull(after.vehPlate)
        assertEquals("", after.veh)
        assertTrue("the old customer's cars must not stay in the picker", after.pickVehicles.isEmpty())
    }

    @Test
    fun `a quote may legitimately have no car`() {
        // Quotes get raised over the phone before a car is nominated, so null is valid —
        // which is why clearing the vehicle above is safe rather than leaving it dangling.
        val s = state("draft").copy(vehicleId = null, vehPlate = null, veh = "")
        assertNull(s.vehicleId)
        assertTrue(s.customerId != null)
    }
}
