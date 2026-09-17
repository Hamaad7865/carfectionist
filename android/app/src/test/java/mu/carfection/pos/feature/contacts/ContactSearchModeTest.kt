package mu.carfection.pos.feature.contacts

import mu.carfection.pos.core.network.ContactDto
import mu.carfection.pos.core.network.ContactVehicleDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Contacts search modes: what matches, in what order, and what the card says.
 *
 * The server filters; these pure functions decide the DISPLAY — ranking and the
 * "why this card" hint. A plate typed in full must lead even when another owner's
 * plate merely contains it, or the wrong card gets opened at the counter.
 */
class ContactSearchModeTest {

    private fun car(plate: String, make: String? = null, model: String? = null) =
        ContactVehicleDto(id = "v-$plate", plate = plate, make = make, model = model)

    private fun customer(id: String, name: String, vararg vehicles: ContactVehicleDto) =
        ContactDto(id = id, name = name, vehicles = vehicles.toList())

    @Test
    fun `an exact plate beats a prefix beats a mid-string hit`() {
        val rows = listOf(
            customer("c1", "Zack", car("1234 AB")),
            customer("c2", "Yash", car("1234")),
            customer("c3", "Ana", car("XY 1234")),
        )

        val ordered = displayOrder(rows, "1234", ContactSearchMode.PLATE).map { it.id }

        assertEquals(listOf("c2", "c1", "c3"), ordered)
    }

    @Test
    fun `a make that starts with the term beats one that merely contains it`() {
        val rows = listOf(
            customer("c1", "Zack", car("P1", make = "Nissan", model = "My Toyota")),
            customer("c2", "Yash", car("P2", make = "Toyota", model = "Aqua")),
        )

        val ordered = displayOrder(rows, "toy", ContactSearchMode.CAR).map { it.id }

        assertEquals(listOf("c2", "c1"), ordered)
    }

    @Test
    fun `customer mode still ranks a leading name first`() {
        val rows = listOf(
            customer("c1", "Abdul Azize"),
            customer("c2", "Zaheer"),
        )

        val ordered = displayOrder(rows, "z", ContactSearchMode.CUSTOMER).map { it.id }

        assertEquals(listOf("c2", "c1"), ordered)
    }

    @Test
    fun `plate mode hints the plate that matched`() {
        val rows = listOf(customer("c1", "Yash", car("1111", make = "Honda"), car("1234 RS 56", make = "Toyota")))

        assertEquals(mapOf("c1" to "1234 RS 56"), matchHints(rows, "1234", ContactSearchMode.PLATE))
    }

    @Test
    fun `car mode hints make, model and plate`() {
        val rows = listOf(customer("c1", "Yash", car("1234 RS 56", make = "Toyota", model = "Aqua")))

        assertEquals(mapOf("c1" to "Toyota Aqua · 1234 RS 56"), matchHints(rows, "aqua", ContactSearchMode.CAR))
    }

    @Test
    fun `customer mode and a blank term hint nothing`() {
        val rows = listOf(customer("c1", "Yash", car("1234 RS 56")))

        assertTrue(matchHints(rows, "yash", ContactSearchMode.CUSTOMER).isEmpty())
        assertTrue(matchHints(rows, "", ContactSearchMode.PLATE).isEmpty())
        assertEquals(rows, displayOrder(rows, "", ContactSearchMode.PLATE))
    }
}
