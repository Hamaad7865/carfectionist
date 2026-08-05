package mu.carfection.pos.feature.quote

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A customer having a service walks the shop and picks something up.
 *
 * It goes on their BILL, not on the quotation — the quote is the price agreed for the
 * work, and reopening it would need a fresh signature for a bottle of wax. So the bill
 * carries two kinds of line at once, and they are not the same thing: the ones that came
 * across from the quote are settled, the ones added at the counter are still being priced.
 *
 * That line was drawn in the UI alone. It is drawn here now, because [billLineEditable]
 * is what the setters ask before they change anything.
 */
class BillLineTest {

    /** A quote of two lines, then a bottle of wax the customer picked up. */
    private val quotedCount = 2
    private val lineCount = 3

    @Test
    fun `a line the customer already agreed is frozen`() {
        assertFalse(billLineEditable(0, quotedCount, lineCount))
        assertFalse(billLineEditable(1, quotedCount, lineCount))
    }

    @Test
    fun `what they picked up at the counter is still open`() {
        assertTrue(billLineEditable(2, quotedCount, lineCount))
    }

    @Test
    fun `a bill raised with nothing quoted is open all the way down`() {
        assertTrue(billLineEditable(0, 0, 2))
        assertTrue(billLineEditable(1, 0, 2))
    }

    /** A line removed under a pending tap must not take the next one with it. */
    @Test
    fun `an index off the end is refused`() {
        assertFalse(billLineEditable(3, quotedCount, lineCount))
        assertFalse(billLineEditable(-1, quotedCount, lineCount))
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
