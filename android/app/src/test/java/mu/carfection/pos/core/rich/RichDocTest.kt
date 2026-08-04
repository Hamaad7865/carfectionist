package mu.carfection.pos.core.rich

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The tablet's half of the rich-content contract.
 *
 * Three walkers read this tree — the React renderer, this one, and the plain-text
 * flattener on each side. The expectations below are deliberately identical to the
 * TypeScript tests in apps/web/src/lib/rich/plain.test.ts. If the two ever disagree
 * about what the owner's four bullets say, a customer gets one document on paper
 * and a different one on the tablet.
 */
class RichDocTest {

    private fun parse(s: String) = parseRichDoc(Json.parseToJsonElement(s))

    private val diamondbrite = """
        {"schemaVersion":1,"blocks":[{"type":"ul","items":[
          [{"text":"Full Vehicle decontamination"}],
          [{"text":"Paint Correction ( 1 - 5 Step polishing depending on surface damages)"}],
          [{"text":"Ceramic Coating 3 years protection on body only"}],
          [{"text":"Plastic treatment and restoration"}]
        ]}]}
    """.trimIndent()

    @Test
    fun `reads a paragraph and its marks`() {
        val doc = parse(
            """{"schemaVersion":1,"blocks":[{"type":"p","runs":[
               {"text":"a","bold":true},{"text":"b","italic":true},
               {"text":"c","strike":true},{"text":"d","href":"https://x/t"}]}]}""",
        )
        val runs = (doc!!.blocks[0] as RichBlock.Paragraph).runs
        assertEquals(4, runs.size)
        assertTrue(runs[0].bold)
        assertTrue(runs[1].italic)
        assertTrue(runs[2].strike)
        assertEquals("https://x/t", runs[3].href)
    }

    @Test
    fun `reads the owner's four bullets`() {
        val doc = parse(diamondbrite)
        val ul = doc!!.blocks[0] as RichBlock.BulletList
        assertEquals(4, ul.items.size)
        assertEquals("Plastic treatment and restoration", ul.items[3][0].text)
    }

    @Test
    fun `reads a numbered list and a table`() {
        val doc = parse(
            """{"schemaVersion":1,"blocks":[
               {"type":"ol","items":[[{"text":"Wash"}],[{"text":"Clay"}]]},
               {"type":"table","rows":[[[{"text":"Stage"}],[{"text":"Covered"}]]]}]}""",
        )
        assertEquals(2, (doc!!.blocks[0] as RichBlock.OrderedList).items.size)
        assertEquals(1, (doc.blocks[1] as RichBlock.Table).rows.size)
        assertEquals(2, (doc.blocks[1] as RichBlock.Table).rows[0].size)
    }

    @Test
    fun `skips a block type this build does not know, and keeps the rest`() {
        val doc = parse("""{"schemaVersion":1,"blocks":[{"type":"hologram"},{"type":"p","runs":[{"text":"kept"}]}]}""")
        assertEquals(1, doc!!.blocks.size)
        assertEquals("kept", (doc.blocks[0] as RichBlock.Paragraph).runs[0].text)
    }

    @Test
    fun `refuses a schema version from the future rather than half-rendering it`() {
        assertEquals(null, parse("""{"schemaVersion":2,"blocks":[]}"""))
    }

    @Test
    fun `returns null for anything that is not a tree, and never throws`() {
        assertEquals(null, parseRichDoc(null))
        assertEquals(null, parse(""""a string that ->> would have left""""))
        assertEquals(null, parse("""42"""))
        assertEquals(null, parse("""[]"""))
    }

    @Test
    fun `flattens exactly as the web does`() {
        // Byte-identical to the expectation in apps/web/src/lib/rich/plain.test.ts.
        assertEquals(
            "- Full Vehicle decontamination\n" +
                "- Paint Correction ( 1 - 5 Step polishing depending on surface damages)\n" +
                "- Ceramic Coating 3 years protection on body only\n" +
                "- Plastic treatment and restoration",
            richToPlainText(parse(diamondbrite)),
        )
    }

    @Test
    fun `numbers ordered items from one, and joins table cells with a pipe`() {
        assertEquals(
            "1. Wash\n2. Clay",
            richToPlainText(parse("""{"schemaVersion":1,"blocks":[{"type":"ol","items":[[{"text":"Wash"}],[{"text":"Clay"}]]}]}""")),
        )
        assertEquals(
            "Stage | Covered\nBody panels | Yes",
            richToPlainText(
                parse(
                    """{"schemaVersion":1,"blocks":[{"type":"table","rows":[
                       [[{"text":"Stage"}],[{"text":"Covered"}]],
                       [[{"text":"Body panels"}],[{"text":"Yes"}]]]}]}""",
                ),
            ),
        )
    }

    @Test
    fun `an empty document flattens to an empty string`() {
        assertEquals("", richToPlainText(parse("""{"schemaVersion":1,"blocks":[]}""")))
        assertEquals("", richToPlainText(null))
    }

    @Test
    fun `builds a tree of bullets that flattens back to the same lines`() {
        // The tablet's own authoring path: plain bullet rows in, valid tree out.
        val doc = bulletsToRichDoc(listOf("Full Vehicle decontamination", "  ", "Plastic treatment and restoration"))
        assertEquals(
            "- Full Vehicle decontamination\n- Plastic treatment and restoration",
            richToPlainText(doc),
        )
    }

    @Test
    fun `builds nothing at all when every bullet row is blank`() {
        assertEquals(null, bulletsToRichDoc(listOf("", "   ")))
    }

    @Test
    fun `reads bullets back out of a tree for editing`() {
        assertEquals(
            listOf(
                "Full Vehicle decontamination",
                "Paint Correction ( 1 - 5 Step polishing depending on surface damages)",
                "Ceramic Coating 3 years protection on body only",
                "Plastic treatment and restoration",
            ),
            richDocToBullets(parse(diamondbrite)),
        )
    }

    @Test
    fun `a tree of plain bullets is safe for the tablet to edit`() {
        assertTrue(isBulletsOnly(parse(diamondbrite)))
        assertTrue(isBulletsOnly(null))
    }

    @Test
    fun `a tree holding anything the tablet cannot author is not safe to edit`() {
        // Rewriting these as bullet rows would silently destroy the back office's work
        // — the same class of bug as the tablet nulling description on every save.
        assertFalse(isBulletsOnly(parse("""{"schemaVersion":1,"blocks":[{"type":"table","rows":[]}]}""")))
        assertFalse(isBulletsOnly(parse("""{"schemaVersion":1,"blocks":[{"type":"ol","items":[]}]}""")))
        assertFalse(
            isBulletsOnly(
                parse("""{"schemaVersion":1,"blocks":[{"type":"ul","items":[[{"text":"a","bold":true}]]}]}"""),
            ),
        )
        assertFalse(
            isBulletsOnly(parse("""{"schemaVersion":1,"blocks":[{"type":"ul","items":[[{"text":"a","href":"https://x"}]]}]}""")),
        )
    }
}
