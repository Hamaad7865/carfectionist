package mu.carfection.pos.core.data

import mu.carfection.pos.core.data.OfflinePinStore.Verifier
import mu.carfection.pos.core.network.RosterEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * How a server roster folds into the verifiers a till holds. These rules decide who a
 * tablet will admit during an outage, so each one is pinned:
 * the server's word replaces, its silence preserves, and its omission revokes.
 */
class ReconcileVerifiersTest {

    private fun held(id: String, verifier: String = "pbkdf2:sha256:1:AA==:AA==", at: Long = 100) =
        Verifier(id, "Held $id", "cashier", verifier, at)

    private fun entry(id: String, verifier: String? = null) =
        RosterEntry(id, "Server $id", "manager", verifier)

    @Test
    fun `a server verifier replaces the held one`() {
        val out = OfflinePinStore.reconcileVerifiers(
            held = listOf(held("anshika", verifier = "pbkdf2:sha256:1:OLD=:OLD=")),
            roster = listOf(entry("anshika", verifier = "pbkdf2:sha256:1:NEW=:NEW=")),
            now = 999,
        )

        val v = out.single()
        assertEquals("pbkdf2:sha256:1:NEW=:NEW=", v.verifier)
        assertEquals("the roster's name and role ride along", "Server anshika", v.displayName)
        assertEquals(999, v.updatedAt)
    }

    /** Staff the server can vouch for are admitted by tablets they have never touched. */
    @Test
    fun `a verifier arrives for someone this tablet has never seen`() {
        val out = OfflinePinStore.reconcileVerifiers(
            held = emptyList(),
            roster = listOf(entry("nick", verifier = "pbkdf2:sha256:1:SEED:SEED")),
            now = 5,
        )

        assertEquals("nick", out.single().appUserId)
    }

    /**
     * The server having nothing to say is not a revocation: a verifier this tablet minted
     * at an online sign-in stays until the server speaks or the person leaves the roster.
     */
    @Test
    fun `a roster entry without a verifier leaves the held one alone`() {
        val mine = held("yohan", verifier = "pbkdf2:sha256:1:MINE:MINE", at = 42)

        val out = OfflinePinStore.reconcileVerifiers(listOf(mine), listOf(entry("yohan")), now = 999)

        assertEquals(mine, out.single())
    }

    /** Deactivated staff and cleared PINs stop unlocking tills the moment a till syncs. */
    @Test
    fun `someone missing from the roster loses their verifier`() {
        val out = OfflinePinStore.reconcileVerifiers(
            held = listOf(held("gone"), held("stays")),
            roster = listOf(entry("stays")),
            now = 999,
        )

        assertNull(out.find { it.appUserId == "gone" })
        assertTrue(out.any { it.appUserId == "stays" })
    }

    @Test
    fun `an empty tablet fed a full roster holds exactly the server's verifiers`() {
        val out = OfflinePinStore.reconcileVerifiers(
            held = emptyList(),
            roster = listOf(
                entry("a", verifier = "pbkdf2:sha256:1:A:A"),
                entry("b"), // no verifier yet — PIN never set with one, never used online
                entry("c", verifier = "pbkdf2:sha256:1:C:C"),
            ),
            now = 1,
        )

        assertEquals(setOf("a", "c"), out.map { it.appUserId }.toSet())
    }
}
