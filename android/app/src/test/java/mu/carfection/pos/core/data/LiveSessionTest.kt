package mu.carfection.pos.core.data

import io.github.jan.supabase.auth.status.RefreshFailureCause
import io.github.jan.supabase.auth.status.SessionSource
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.user.UserSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A read sent without a live sign-in is not refused — the client falls back to the anon
 * key and RLS answers `[]` with HTTP 200. On 2026-10-24 the reception tablet spent a morning
 * that way: let in by the offline PIN, back on Wi-Fi, no session — every list empty, every
 * customer "missing". These are the two decisions that stop it.
 */
class LiveSessionTest {

    private val signedOut = SessionStatus.NotAuthenticated(isSignOut = false)
    private val renewing = SessionStatus.RefreshFailure(RefreshFailureCause.NetworkError(RuntimeException("blip")))

    @Test
    fun `an offline admission ends once the network is back and there is no session`() {
        assertTrue(needsOnlineReSignIn(online = true, offlineUnlocked = true, status = signedOut))
    }

    @Test
    fun `an offline admission stands while the tablet is still offline`() {
        assertFalse(needsOnlineReSignIn(online = false, offlineUnlocked = true, status = signedOut))
    }

    @Test
    fun `a session that is only renewing is not a reason to send anyone to the PIN pad`() {
        // A blip on the hourly renewal retries by itself; kicking the cashier out over it
        // wiped carts once (audit #8).
        assertFalse(needsOnlineReSignIn(online = true, offlineUnlocked = true, status = renewing))
        assertFalse(needsOnlineReSignIn(online = true, offlineUnlocked = true, status = SessionStatus.Initializing))
    }

    @Test
    fun `an operator signed in online is never touched`() {
        assertFalse(needsOnlineReSignIn(online = true, offlineUnlocked = false, status = signedOut))
    }

    @Test
    fun `reads go ahead only on a live session`() {
        val live = SessionStatus.Authenticated(
            UserSession(accessToken = "a", refreshToken = "r", expiresIn = 3600, tokenType = "bearer", user = null),
            SessionSource.Unknown,
        )
        assertNull(readsUnavailableReason(live, online = true))
        // Offline with a live session: let the read fail on its own — the network error says why.
        assertNull(readsUnavailableReason(live, online = false))
    }

    @Test
    fun `no live session is said out loud, never shown as an empty list`() {
        assertNotNull(readsUnavailableReason(signedOut, online = true))
        assertNotNull(readsUnavailableReason(renewing, online = true))
        assertNotNull(readsUnavailableReason(SessionStatus.Initializing, online = true))
        assertNotNull(readsUnavailableReason(signedOut, online = false))
    }

    @Test
    fun `an expired sign-in tells the operator how to get back`() {
        assertTrue(readsUnavailableReason(signedOut, online = true)!!.contains("PIN"))
    }

    @Test
    fun `offline says offline`() {
        assertEquals(OFFLINE_READS, readsUnavailableReason(signedOut, online = false))
        assertEquals(OFFLINE_READS, readsUnavailableReason(renewing, online = false))
    }
}
