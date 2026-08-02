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

    /**
     * The one failure staff will actually meet. Opening a till, cutting a Z and banking a
     * float all need the server, so during an outage they fail — and the raw text is a DNS
     * error naming the Supabase host, which reads like the app is broken at exactly the
     * moment the shop needs to start trading. Say it is the line, and say what still works.
     */
    @Test
    fun `an unreachable server reads as being offline, not as a broken app`() {
        val hostFail = java.net.UnknownHostException(
            """Unable to resolve host "qecydemyqxdxwhkiyjtp.supabase.co": No address associated with hostname""",
        )
        val msg = hostFail.uiMessage()
        assertTrue("must name the connection, not DNS: $msg", msg.contains("offline", ignoreCase = true))
        assertTrue("must not leak the backend host: $msg", !msg.contains("supabase", ignoreCase = true))
    }

    @Test
    fun `a dropped connection also reads as being offline`() {
        val dropped = java.net.ConnectException("Failed to connect to /142.250.184.1:443")
        assertTrue(dropped.uiMessage().contains("offline", ignoreCase = true))
    }

    /** Ktor wraps the socket failure, so the real cause can be a couple of levels down. */
    @Test
    fun `a wrapped connection failure is still recognised`() {
        val wrapped = RuntimeException("request failed", java.net.SocketTimeoutException("timeout"))
        assertTrue(wrapped.uiMessage().contains("offline", ignoreCase = true))
    }

    @Test
    fun `a server refusal is never mistaken for an outage`() {
        // A real answer from the server must survive untouched, even mid-outage-looking wording.
        val e = RuntimeException("the day is closed — reopen it before taking more money")
        assertEquals("the day is closed — reopen it before taking more money", e.uiMessage())
    }
}
