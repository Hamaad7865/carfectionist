package mu.carfection.pos.feature.quote

import mu.carfection.pos.core.network.JobVehicleDto
import mu.carfection.pos.core.network.QuoteJobDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Yogen brings three cars, signs ONE quotation, and gets THREE job cards. The screen used
 * to offer a single "View job" — which went through `documents.job_id`, the first car and
 * nothing else — so whichever car you meant, the Vitz opened. The Eclipse and the GT86
 * were reachable only by hunting the board.
 *
 * The cards are read back through `jobs.source_quote_id`, which knows all three.
 */
class QuoteJobCardsTest {

    private fun job(id: String, plate: String?, make: String?, model: String? = null) =
        QuoteJobDto(id = id, status = "in_progress", vehicleId = "v-$id", vehicles = JobVehicleDto(plate, make, model))

    private val threeCars = listOf(
        job("11df1111-0000-0000-0000-000000000001", "1727 JZ 19", "Toyota", "Vitz"),
        job("22ab2222-0000-0000-0000-000000000002", "7890 JK 22", "Mitsubishi", "Eclipse"),
        job("33cd3333-0000-0000-0000-000000000003", "8978 JZ 20", "Nissan", "GT86"),
    )

    @Test
    fun `a three-car quotation offers three cards, one per car`() {
        val refs = quoteJobRefs(threeCars)
        assertEquals(3, refs.size)
        assertEquals(listOf("1727 JZ 19", "7890 JK 22", "8978 JZ 20"), refs.map { it.plate })
        assertEquals(listOf("Toyota Vitz", "Mitsubishi Eclipse", "Nissan GT86"), refs.map { it.label })
    }

    /** jobId stays the FIRST card, so every branch that only asks "is there a job" is unmoved. */
    @Test
    fun `the first card is the one jobId names`() {
        assertEquals(threeCars.first().id, quoteJobRefs(threeCars).first().id)
    }

    @Test
    fun `each card carries the board's own reference`() {
        assertEquals("JOB-11DF", quoteJobRefs(threeCars)[0].code)
        assertEquals("JOB-22AB", quoteJobRefs(threeCars)[1].code)
    }

    /** The board returns the cards in creation order — the order the cars' charges first
     *  appear on the quotation. Naming them in any other order would misread the document. */
    @Test
    fun `the board's order is kept`() {
        val shuffled = listOf(threeCars[2], threeCars[0], threeCars[1])
        assertEquals(listOf("8978 JZ 20", "1727 JZ 19", "7890 JK 22"), quoteJobRefs(shuffled).map { it.plate })
    }

    /** The ordinary quotation: one car, one card, and the screen keeps its plain button. */
    @Test
    fun `one car is one card`() {
        assertEquals(1, quoteJobRefs(listOf(threeCars.first())).size)
    }

    /** A car recorded with nothing but a plate must still read as a car, never a blank row. */
    @Test
    fun `a car with no make or model still has a name`() {
        val refs = quoteJobRefs(listOf(job("aaaa1111-0000-0000-0000-00000000000a", "2211 MR 23", null, null)))
        assertEquals("Vehicle", refs.single().label)
        assertEquals("2211 MR 23", refs.single().plate)
    }

    /** A job whose vehicle was never joined must not crash the row, nor invent a plate. */
    @Test
    fun `a card with no car at all is still offered`() {
        val refs = quoteJobRefs(listOf(QuoteJobDto(id = "bbbb2222-0000-0000-0000-00000000000b")))
        assertEquals(1, refs.size)
        assertTrue("no plate should be invented", refs.single().plate == null)
        assertEquals("Vehicle", refs.single().label)
    }
}
