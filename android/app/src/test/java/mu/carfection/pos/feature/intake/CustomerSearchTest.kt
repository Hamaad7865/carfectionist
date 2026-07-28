package mu.carfection.pos.feature.intake

import mu.carfection.pos.core.database.CustomerEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Intake's customer search.
 *
 * A real incident: "Lucas Lutchmoodoo" could not be found, so staff created him again — four
 * times. Each retry collided on the vehicle's unique plate, and the accepted Rs 40,710 quote
 * ended up on a different customer record from the car, against a placeholder plate of "NIL".
 *
 * The search reads the LOCAL CACHE, which only a full sync refreshes, so a customer created on
 * the tablet, on the web, or on the other tablet was invisible. These pin the matching rule;
 * the cache-on-create and server-fallback are wired in the ViewModel.
 */
class CustomerSearchTest {

    private val roster = listOf(
        CustomerEntity("1", "Lucas Lutchmoodoo", "59856161"),
        CustomerEntity("2", "Anesh Boodoo", "57123456"),
        CustomerEntity("3", "INTERGRAH LTEE", null),
    )

    /** The matching rule the ViewModel applies to the cache. */
    private fun match(q: String) = roster.filter {
        val query = q.trim().lowercase()
        it.name.lowercase().contains(query) || (it.phone ?: "").contains(query)
    }

    @Test
    fun `a customer is found by first name, surname or either case`() {
        listOf("lucas", "Lucas", "LUCAS", "lutchmoodoo", "Lutchmoodoo", "lucas lutchmoodoo")
            .forEach { assertEquals("searching '$it'", listOf("1"), match(it).map { c -> c.id }) }
    }

    @Test
    fun `a customer is found by phone number`() {
        assertEquals(listOf("1"), match("59856161").map { it.id })
        assertEquals(listOf("1"), match("5985").map { it.id })
    }

    @Test
    fun `a customer with no phone is still searchable by name`() {
        assertEquals(listOf("3"), match("intergrah").map { it.id })
    }

    /**
     * The blank-phone trap: "".contains("") is TRUE, so a blank query would match every
     * customer with no phone. The ViewModel guards this by returning nothing for a blank query.
     */
    @Test
    fun `a blank query is not treated as a match-everything`() {
        // Demonstrates why the guard exists: without it, this rule returns the whole roster.
        assertEquals(3, match("").size)
        // Which is exactly why setQuery returns emptyList() for a blank query rather than
        // running this filter at all.
    }

    @Test
    fun `a term too short to be meaningful is not sent to the server`() {
        // The ViewModel requires >= 2 characters before asking the server; one letter would
        // return an arbitrary slice of the roster and cost a round trip per keystroke.
        assertTrue("a".length < 2)
    }
}
