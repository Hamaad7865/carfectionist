package mu.carfection.pos.core.network

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.descriptors.elementNames
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The column list and the DTO must agree.
 *
 * PostgREST returns only the columns it is asked for, so a field the DTO declares but
 * the select omits decodes as null — and because save_draft deletes and re-inserts
 * every line, the tablet then writes that null back over a real value.
 *
 * That is not hypothetical. description_richtext and unit_label were added to the DTO
 * and to the save payload, every unit test passed, and the first end-to-end run still
 * erased both: fetchQuoteLines was still asking for the old nine columns. The unit
 * tests could not see it because they handed quoteLineJson a line that already had its
 * tree. This test is the cheap guard that would have caught it.
 */
class QuoteLineColumnsTest {

    @OptIn(ExperimentalSerializationApi::class)
    @Test
    fun `every field QuoteLineDto declares is actually fetched`() {
        val asked = QUOTE_LINE_COLUMNS.split(",").map { it.trim() }.filter { it.isNotEmpty() }.toSet()
        val declared = QuoteLineDto.serializer().descriptor.elementNames.toSet()

        assertEquals("columns the DTO wants but the query never asks for", emptySet<String>(), declared - asked)
        assertEquals("columns fetched that nothing decodes", emptySet<String>(), asked - declared)
    }
}
