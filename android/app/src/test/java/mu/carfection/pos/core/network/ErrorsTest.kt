package mu.carfection.pos.core.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the person at the till reads when a call fails.
 *
 * Two rules matter. The message must never carry the HTTP request dump supabase-kt appends
 * (a photo of the screen must not leak a bearer token). And a dead sign-in must say it is a
 * dead sign-in: a session that cannot refresh keeps LOOKING signed in — reads come off the
 * local cache — so the first server write is where it surfaces, as a row-level-security or
 * JWT rejection. Staff read "RLS" as a data bug; the way out is sign out and back in.
 */
class ErrorsTest {

    @Test
    fun `the request dump is stripped before anyone sees it`() {
        val e = RuntimeException("duplicate key value, URL: https://x.supabase.co/rest/v1/thing Headers: Authorization: Bearer secret")
        assertEquals("duplicate key value", e.uiMessage())
    }

    @Test
    fun `an ordinary server message passes through untouched`() {
        // The DB's own refusals are already written for people — never rewrite them.
        val e = RuntimeException("this till is closed — its count cannot be changed")
        assertEquals("this till is closed — its count cannot be changed", e.uiMessage())
    }

    @Test
    fun `a row-level security rejection reads as an expired sign-in`() {
        val e = RuntimeException("""new row violates row-level security policy for table "objects"""")
        assertTrue(e.uiMessage().contains("sign out and sign back in"))
    }

    @Test
    fun `a JWT rejection reads as an expired sign-in`() {
        val e = RuntimeException("JWT expired")
        assertTrue(e.uiMessage().contains("sign out and sign back in"))
    }

    @Test
    fun `a revoked refresh token reads as an expired sign-in`() {
        val e = RuntimeException("invalid_grant: refresh_token has been revoked")
        assertTrue(e.uiMessage().contains("sign out and sign back in"))
    }

    @Test
    fun `no message still falls back`() {
        assertEquals("try again", RuntimeException(null as String?).uiMessage("try again"))
    }
}
