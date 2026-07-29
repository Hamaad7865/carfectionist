package mu.carfection.pos.feature.jobs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The jobs board picks a crew the same way the quote's accept panel does: one tap on or off,
 * first on is the lead.
 *
 * Here the two seats are stored apart — the lead on jobs.technician_id, the rest in
 * job_technicians — so this pins the rule that decides which seat a tap moves someone into.
 */
class JobsCrewTest {

    /** Mirrors JobsViewModel.roster: lead first, and never twice. */
    private fun roster(lead: String?, crew: List<String>) =
        listOfNotNull(lead) + crew.filter { it != lead }

    /** What tapTech decides to do — the branch, without the network writes. */
    private sealed interface Move {
        data class SetLead(val id: String?) : Move
        data class AddCrew(val id: String) : Move
        data class DropCrew(val id: String) : Move
        data class Promote(val next: String?) : Move
    }

    private fun tap(lead: String?, crew: List<String>, id: String): Move {
        val r = roster(lead, crew)
        return when {
            id !in r -> if (r.isEmpty()) Move.SetLead(id) else Move.AddCrew(id)
            id == r.first() -> Move.Promote(r.getOrNull(1))
            else -> Move.DropCrew(id)
        }
    }

    @Test
    fun `the first one tapped leads`() {
        assertEquals(Move.SetLead("a"), tap(null, emptyList(), "a"))
    }

    @Test
    fun `anyone after the lead joins the crew`() {
        assertEquals(Move.AddCrew("b"), tap("a", emptyList(), "b"))
    }

    @Test
    fun `tapping a crew member takes them off`() {
        assertEquals(Move.DropCrew("b"), tap("a", listOf("b"), "b"))
    }

    /** The seat has to be filled, or a job with people on it would have no lead. */
    @Test
    fun `tapping the lead promotes the next one`() {
        assertEquals(Move.Promote("b"), tap("a", listOf("b", "c"), "a"))
    }

    @Test
    fun `tapping the only person leaves the job unassigned`() {
        assertEquals(Move.Promote(null), tap("a", emptyList(), "a"))
    }

    /** A stray job_technicians row for the lead must not show them twice. */
    @Test
    fun `the lead is never listed twice`() {
        assertEquals(listOf("a", "b"), roster("a", listOf("a", "b")))
    }

    @Test
    fun `an unassigned job with no crew is empty`() {
        val r = roster(null, emptyList())
        assertTrue(r.isEmpty())
        assertNull(r.firstOrNull())
    }
}
