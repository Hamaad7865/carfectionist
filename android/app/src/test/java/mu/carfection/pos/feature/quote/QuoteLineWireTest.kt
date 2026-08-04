package mu.carfection.pos.feature.quote

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the tablet sends for a line, pinned.
 *
 * This exists for one bug. `save_draft` deletes every line of a document and
 * re-inserts them from this payload, and the tablet used to hard-code
 * `description = null` on every line of every save. While nothing on the web could
 * write a description that was invisible; the moment the back office could type
 * one, the next tablet save of the same quote would silently erase it.
 *
 * `a description written at the desk survives a save from the tablet` is the
 * regression guard for that, and it is the reason this fix shipped in the same
 * step as the editor rather than after it.
 */
class QuoteLineWireTest {

    /** The owner's real line, as the web editor stores it. */
    private val diamondbrite = Json.parseToJsonElement(
        """
        {"schemaVersion":1,"blocks":[{"type":"ul","items":[
          [{"text":"Full Vehicle decontamination"}],
          [{"text":"Paint Correction ( 1 - 5 Step polishing depending on surface damages)"}],
          [{"text":"Ceramic Coating 3 years protection on body only"}],
          [{"text":"Plastic treatment and restoration"}]
        ]}]}
        """.trimIndent(),
    )

    private fun line(
        title: String = "Diamondbrite 3 YEARS PROTECTION Exterior only",
        description: String? = null,
        rich: kotlinx.serialization.json.JsonElement? = null,
        unitLabel: String = "",
    ) = QuoteLine(
        productId = null,
        title = title,
        priceText = "30434.78",
        vatRate = 15.0,
        description = description,
        richJson = rich,
        unitLabel = unitLabel,
    )

    @Test
    fun `a description written at the desk survives a save from the tablet`() {
        val out = quoteLineJson(line(description = "- Full Vehicle decontamination", rich = diamondbrite), 0)

        assertEquals("- Full Vehicle decontamination", out["description"]!!.jsonPrimitive.content)
        assertEquals(diamondbrite, out["description_richtext"])
        // The bullets are still readable inside the payload, not flattened to a string.
        val items = out["description_richtext"]!!.jsonObject["blocks"]!!
        assertTrue(items.toString().contains("Plastic treatment and restoration"))
    }

    @Test
    fun `a line the tablet never gave a description sends nulls, exactly as before`() {
        val out = quoteLineJson(line(), 0)
        assertEquals(JsonNull, out["description"])
        assertEquals(JsonNull, out["description_richtext"])
        assertEquals(JsonNull, out["unit_label"])
    }

    @Test
    fun `the unit rides along`() {
        val out = quoteLineJson(line(unitLabel = "panels"), 0)
        assertEquals("panels", out["unit_label"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a blank unit is sent as null rather than an empty string`() {
        val out = quoteLineJson(line(unitLabel = "   "), 0)
        assertEquals(JsonNull, out["unit_label"])
    }

    @Test
    fun `the rest of the payload is unchanged`() {
        val out = quoteLineJson(line(), 3)
        assertEquals("Diamondbrite 3 YEARS PROTECTION Exterior only", out["title"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, out["product_id"])
        assertEquals(1, out["qty"]!!.jsonPrimitive.content.toInt())
        assertEquals(3, out["sort_order"]!!.jsonPrimitive.content.toInt())
        assertEquals("percent", out["discount_kind"]!!.jsonPrimitive.content)
        assertEquals(15.0, out["vat_rate"]!!.jsonPrimitive.content.toDouble(), 0.001)
        assertNull(out["nonexistent_key"])
    }
}
