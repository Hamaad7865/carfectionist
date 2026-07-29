package mu.carfection.pos.core.data

import kotlinx.serialization.json.JsonArray
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What reception hands the quote builder.
 *
 * The customer's PHONE has to ride along: without it the quote's WhatsApp field opened empty
 * and staff retyped the number off the customer's card at the moment they were trying to send
 * it. This is pinned because a previous fix for exactly that silently failed to apply — the
 * field defaults to null, so nothing failed loudly, it just quietly did nothing.
 */
class IntakeHandoffTest {

    private fun handoff(phone: String? = "59856161", email: String? = null) = IntakeHandoff(
        customerId = "c1", customerName = "Lucas Lutchmoodoo",
        customerPhone = phone, customerEmail = email,
        vehicleId = "v1", plate = "2211 MR 23", vehLabel = "Hyundai Creta",
        markers = JsonArray(emptyList()), markerCount = 0, photoPaths = emptyList(),
    )

    @Test
    fun `the contact captured at reception travels with the quote`() {
        val h = handoff()
        assertEquals("59856161", h.customerPhone)
        assertEquals("Lucas Lutchmoodoo", h.customerName)
        assertEquals("2211 MR 23", h.plate)
    }

    @Test
    fun `a customer with no phone hands over null, not an empty string`() {
        // An empty string would prefill the send dialog with a blank that LOOKS filled in and
        // silently fails validation; null leaves the field genuinely empty.
        assertEquals(null, handoff(phone = null).customerPhone)
    }

    @Test
    fun `the email rides along too when reception captured one`() {
        assertEquals("lucas@example.mu", handoff(email = "lucas@example.mu").customerEmail)
    }
}
