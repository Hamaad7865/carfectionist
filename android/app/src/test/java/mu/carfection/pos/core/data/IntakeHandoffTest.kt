package mu.carfection.pos.core.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import mu.carfection.pos.core.database.CustomerEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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

    private fun car(id: String, plate: String, label: String, marks: Int = 0, photos: List<String> = emptyList()) =
        HandoffCar(
            vehicleId = id, plate = plate, label = label,
            markers = JsonArray(List(marks) { JsonObject(emptyMap()) }), markerCount = marks, photoPaths = photos,
        )

    private fun handoff(
        phone: String? = "59856161",
        email: String? = null,
        cars: List<HandoffCar> = listOf(car("v1", "2211 MR 23", "Hyundai Creta")),
    ) = IntakeHandoff(
        customerId = "c1", customerName = "Lucas Lutchmoodoo",
        customerPhone = phone, customerEmail = email, cars = cars,
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

    /**
     * The email's whole trip: PosApi.insertCustomer's response → the Room read-cache
     * (CustomerEntity, picked as "the" customer) → this handoff. Before CustomerEntity carried
     * an email field, a business customer typed fresh at Intake had their email accepted by the
     * server and then dropped on the floor for the rest of the session — IntakeViewModel had
     * nowhere to put it between "just created" and "handed to the quote builder".
     */
    @Test
    fun `a freshly created customer's email survives the Room round-trip into the handoff`() {
        val created = CustomerEntity(id = "c9", name = "Vertex Motors Ltd", phone = "5800 1122", email = "accounts@vertex.mu")
        val h = handoff(phone = created.phone, email = created.email)
        assertEquals("accounts@vertex.mu", h.customerEmail)
    }

    /**
     * Yogen drives in with three cars. That is ONE hand-over — the whole point of the change:
     * reception ticks three, and the builder receives three, in the order they were ticked.
     */
    @Test
    fun `every car ticked at reception reaches the builder, in order`() {
        val h = handoff(cars = listOf(
            car("v1", "2087 JL 25", "Toyota Hilux", marks = 2),
            car("v2", "1234 AB 22", "Nissan Almera"),
            car("v3", "9876 ZZ 19", "Suzuki Swift", marks = 1),
        ))
        assertEquals(listOf("v1", "v2", "v3"), h.cars.map { it.vehicleId })
        assertEquals("2087 JL 25", h.plate)          // the first car heads the document
        assertEquals(3, h.markerCount)               // damage notes across the whole visit
    }

    /**
     * A one-car hand-over must read EXACTLY as it did before cars became a list — the quote
     * builder reads plate/label/markers straight off it, and an ordinary quote is still the
     * common case by far.
     */
    @Test
    fun `one car still answers plate, label and markers as a single car did`() {
        val h = handoff(cars = listOf(car("v9", "3344 QQ 21", "Kia Picanto", marks = 4, photos = listOf("p/1.jpg"))))
        assertEquals("v9", h.vehicleId)
        assertEquals("3344 QQ 21", h.plate)
        assertEquals("Kia Picanto", h.vehLabel)
        assertEquals(4, h.markerCount)
        assertEquals(listOf("p/1.jpg"), h.photoPaths)
    }

    @Test
    fun `an existing CustomerEntity call site with no email argument still compiles and defaults to null`() {
        // Guards the default param: search results and other read-cache paths that only ever
        // had id, name, phone must keep working unchanged.
        val c = CustomerEntity("c1", "Walk-in", "59856161")
        assertNull(c.email)
    }
}
