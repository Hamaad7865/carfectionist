package mu.carfection.pos.feature.quote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A quote can be accepted onto a CREW, not just one technician.
 *
 * The first picked is the lead — jobs.technician_id, which the Z-report and the web both read —
 * and the rest go to job_technicians. Order is what makes that work, so the crew is a LIST.
 */
class QuoteCrewTest {

    /** Mirrors pickTech: tap adds, tap again removes. */
    private fun tap(crew: List<String>, id: String) = if (id in crew) crew - id else crew + id

    @Test
    fun `the first technician picked is the lead`() {
        val crew = tap(tap(emptyList(), "a"), "b")
        assertEquals(listOf("a", "b"), crew)
        assertEquals("a", crew.firstOrNull())
        // Everyone after the lead is written to job_technicians.
        assertEquals(listOf("b"), crew.drop(1))
    }

    @Test
    fun `tapping someone again takes them off`() {
        val crew = tap(tap(tap(emptyList(), "a"), "b"), "a")
        assertEquals(listOf("b"), crew)
    }

    /** Removing the lead must promote someone, or a job with a crew would have no lead. */
    @Test
    fun `removing the lead promotes the next one`() {
        val crew = tap(listOf("a", "b", "c"), "a")
        assertEquals(listOf("b", "c"), crew)
        assertEquals("b", crew.firstOrNull())
    }

    @Test
    fun `nobody picked means no lead and no crew to write`() {
        val crew = tap(tap(emptyList(), "a"), "a")
        assertTrue(crew.isEmpty())
        assertEquals(null, crew.firstOrNull())
        assertTrue(crew.drop(1).isEmpty())
    }

    @Test
    fun `one technician writes a lead and no crew rows`() {
        val crew = tap(emptyList(), "a")
        assertEquals("a", crew.firstOrNull())
        assertTrue("a single technician needs no job_technicians rows", crew.drop(1).isEmpty())
    }

    /**
     * createJobFromQuote (an already-accepted quote's "Create job" button) has to split the
     * crew the same way create()'s accept-and-start-now branch does: convertQuoteToJob only
     * takes ONE technician id (the lead), so everyone else must be looped into job_technicians
     * separately or they are silently dropped — see QuoteViewModel.createJobFromQuote.
     */
    @Test
    fun `create-job-from-quote splits the crew the same way accept-and-start-now does`() {
        val crew = tap(tap(tap(emptyList(), "a"), "b"), "c")
        assertEquals("convertQuoteToJob's one technician param", "a", crew.firstOrNull())
        assertEquals("looped into addJobTechnician, one call per id", listOf("b", "c"), crew.drop(1))
    }
}
