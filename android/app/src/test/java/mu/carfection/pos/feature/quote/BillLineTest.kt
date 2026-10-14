package mu.carfection.pos.feature.quote

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A customer having a service walks the shop and picks something up — and the work
 * done is not always the work quoted.
 *
 * Owner's rule (2026-10-14): every line on a draft bill can be edited or removed,
 * including the ones that came across from the accepted quote. The bill says what was
 * actually done. This file used to assert the opposite (quoted lines frozen); that rule
 * was the owner's complaint, not a test being weakened. The fiscal lock starts when the
 * bill is ISSUED, not before.
 */
class BillLineTest {

    @Test
    fun `a line that came across from the quote can be edited`() {
        assertTrue(billLineEditable(0, 3))
        assertTrue(billLineEditable(1, 3))
    }

    @Test
    fun `what they picked up at the counter is editable too`() {
        assertTrue(billLineEditable(2, 3))
    }

    /** A line removed under a pending tap must not take the next one with it. */
    @Test
    fun `an index off the end is refused`() {
        assertFalse(billLineEditable(3, 3))
        assertFalse(billLineEditable(-1, 3))
    }

    @Test
    fun `removing a quoted line shrinks the quoted count, removing an extra does not`() {
        assertEquals(1, quotedCountAfterRemoval(0, 2))
        assertEquals(1, quotedCountAfterRemoval(1, 2))
        assertEquals(2, quotedCountAfterRemoval(2, 2))
    }

    /** Quote: engine bay + under chassis. Bill after a visit: under chassis + a wax bottle. */
    @Test
    fun `a removed quoted line does not turn the counter extra into a quoted one`() {
        val quote = listOf("p-bay" to "STEAM ENGINE BAY", "p-chassis" to "Under Chassis")
        val bill = listOf("p-chassis" to "Under Chassis", "p-wax" to "Wax 500ml")
        assertEquals(1, quotedPrefixLength(quote, bill))
    }

    @Test
    fun `an extra of the same product as a quoted line still counts as an extra`() {
        val quote = listOf("p-wax" to "Wax 500ml")
        val bill = listOf("p-wax" to "Wax 500ml", "p-wax" to "Wax 500ml")
        assertEquals(1, quotedPrefixLength(quote, bill))
    }

    @Test
    fun `an untouched bill is all quoted, then the extras`() {
        val quote = listOf(null to "Polish", "p-1" to "Wash")
        assertEquals(2, quotedPrefixLength(quote, quote + ("p-9" to "Air freshener")))
        assertEquals(0, quotedPrefixLength(quote, listOf("p-9" to "Air freshener")))
    }

    /**
     * The trap that printed Rs 17,391.30 against a Rs 20,000 shelf price.
     *
     * `unitCents` is ALWAYS the net the ledger stores, whatever the operator typed — so
     * anything putting a line's money on screen has to gross it back up. The quote's ALSO
     * ON THEIR BILL section did `qty × unitCents` and showed the customer's Rs 20,000
     * bottle as Rs 17,391.30.
     */
    @Test
    fun `a shelf-priced line stores the net, so showing it means grossing it back up`() {
        val shelf = QuoteLine(null, "GM-9704(1600W)", "20000", 15.0, priceIsGross = true)
        assertEquals(1_739_130L, shelf.unitCents)
        assertEquals(2_000_000L, mu.carfection.pos.core.money.grossCents(shelf.unitCents, 15.0))

        // …and when the shop quotes net, what was typed IS the net and nothing converts.
        val net = QuoteLine(null, "GM-9704(1600W)", "17391.30", 15.0, priceIsGross = false)
        assertEquals(1_739_130L, net.unitCents)
    }

    /**
     * The bill used to send a thinner payload of its own that hard-coded `description` to
     * null and never sent `unit_label`, so a line written at the counter reached the
     * invoice stripped of what it said it included. It sends what a quote line sends now.
     */
    @Test
    fun `a line added at the counter reaches the invoice with what it includes`() {
        val rich = Json.parseToJsonElement(
            """{"schemaVersion":1,"blocks":[{"type":"ul","items":[[{"text":"Applied by hand"}]]}]}""",
        )
        val out = quoteLineJson(
            QuoteLine(
                productId = null, title = "Ceramic wax", priceText = "850", vatRate = 15.0,
                description = "- Applied by hand", richJson = rich, unitLabel = "bottle",
                lineKind = "product",
            ),
            0,
        )
        assertEquals("- Applied by hand", out["description"]!!.jsonPrimitive.content)
        assertEquals(rich, out["description_richtext"])
        assertEquals("bottle", out["unit_label"]!!.jsonPrimitive.content)
        assertEquals("product", out["line_kind"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, out["product_id"])
    }
}
