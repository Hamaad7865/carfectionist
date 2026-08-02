package mu.carfection.pos.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The two pieces that stand in for the server at the offline PIN gate: the verifier a
 * tablet mints for itself, and the throttle that replaces the server's lockout.
 */
class PinSecurityTest {

    // ── the verifier ──────────────────────────────────────────────────────────

    @Test
    fun `the right PIN verifies and a wrong one does not`() {
        val stored = PinHasher.hash("4271")

        assertTrue(PinHasher.verify("4271", stored))
        assertFalse(PinHasher.verify("4272", stored))
        assertFalse(PinHasher.verify("", stored))
    }

    @Test
    fun `the PIN itself never appears in what is stored`() {
        val stored = PinHasher.hash("4271")

        assertFalse(stored.contains("4271"))
        assertTrue("self-describing format survives future upgrades", stored.startsWith("pbkdf2:sha256:"))
    }

    /** Same PIN twice → different verifiers — the salt is doing its job. */
    @Test
    fun `two operators with the same PIN store different verifiers`() {
        assertNotEquals(PinHasher.hash("4271"), PinHasher.hash("4271"))
    }

    @Test
    fun `a corrupted verifier verifies nothing`() {
        listOf(
            "", "garbage", "pbkdf2:sha256:oops:AA==:BB==",
            "pbkdf2:sha256:310000:%%%:BB==", "md5:legacy:1:AA==:BB==",
            "pbkdf2:sha256:-1:AA==:BB==",
        ).forEach { broken ->
            assertFalse("\"$broken\" must not verify", PinHasher.verify("4271", broken))
        }
    }

    /**
     * A verifier minted by the SERVER (pos-auth edge function / the web team action, both
     * PBKDF2-HMAC-SHA256) must verify here byte-for-byte. This vector was produced by
     * Node's crypto.pbkdf2Sync — the same primitive both of them use. If this test breaks,
     * the three implementations have drifted and offline sign-in silently dies.
     */
    @Test
    fun `a server-minted verifier verifies on the tablet`() {
        val serverMinted = "pbkdf2:sha256:310000:QzRSRjNDVDEwTjFTVFBJTg==:HiynsG7zaar5MKKyDsoWBc9cgXNF9RLDeOFMhNcqnO4="

        assertTrue(PinHasher.verify("4271", serverMinted))
        assertFalse(PinHasher.verify("4272", serverMinted))
    }

    // ── the throttle ──────────────────────────────────────────────────────────

    @Test
    fun `a few typos cost nothing`() {
        (0 until PinThrottle.FREE_ATTEMPTS).forEach { fails ->
            assertEquals(0, PinThrottle.lockRemainingMs(fails, lastFailAtMs = 1_000, nowMs = 1_001))
        }
    }

    @Test
    fun `the fifth fail locks the keypad for a minute`() {
        val remaining = PinThrottle.lockRemainingMs(5, lastFailAtMs = 10_000, nowMs = 10_001)

        assertEquals(60_000 - 1, remaining)
    }

    @Test
    fun `each further fail doubles the wait`() {
        assertEquals(120_000, PinThrottle.lockRemainingMs(6, 0, 0))
        assertEquals(240_000, PinThrottle.lockRemainingMs(7, 0, 0))
    }

    /** Someone hammering the keypad for an hour still waits at most 15 minutes. */
    @Test
    fun `the wait is capped so a lockout is never forever`() {
        assertEquals(15 * 60_000L, PinThrottle.lockRemainingMs(50, 0, 0))
        // and a huge fail count must not overflow into a negative (unlocked!) wait
        assertTrue(PinThrottle.lockRemainingMs(10_000, 0, 0) > 0)
    }

    @Test
    fun `the lock expires once its time has passed`() {
        assertEquals(0, PinThrottle.lockRemainingMs(5, lastFailAtMs = 0, nowMs = 60_001))
    }
}
