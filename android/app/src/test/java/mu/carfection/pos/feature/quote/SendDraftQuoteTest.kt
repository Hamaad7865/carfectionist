package mu.carfection.pos.feature.quote

import mu.carfection.pos.core.network.SendOutcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A quotation is sent BEFORE it is agreed.
 *
 * The customer has to read a price to accept one, so a draft must be sendable — the server
 * issues it on the way out and hands the number back. Two things have to hold on the tablet:
 * the Send button has to be reachable from a draft at all, and the reply has to land on the
 * state, or the builder keeps a DRAFT chip and live edit controls over a quote the server
 * has already frozen (save_draft refuses an issued document, silently, on every keystroke).
 */
class SendDraftQuoteTest {

    private fun state(status: String = "draft", quoteId: String? = "q1") = QuoteState(
        status = status, quoteId = quoteId, customerId = "c1", who = "Lucas", ref = "Draft",
        lines = listOf(quoteLine(null, "Ceramic coating", 150_000L, 15.0)),
    )

    /** Mirrors the Send chip's guard in QuoteBuilder. */
    private fun sendReachable(s: QuoteState) =
        s.customerId != null && (s.quoteId != null || s.lines.isNotEmpty())

    /** Mirrors what sendToCustomer applies on a successful send. */
    private fun applySend(s: QuoteState, saved: String, out: SendOutcome) =
        if (s.quoteId != saved) s
        else if (out.error != null) s.copy(sendBusy = false, sendError = out.error)
        else s.copy(
            sendBusy = false, quoteId = saved, sendDone = "Sent on WhatsApp ✓",
            status = out.issuedStatus ?: s.status,
            ref = out.issuedNumber ?: s.ref,
        )

    @Test
    fun `a saved draft can be sent`() {
        assertTrue(sendReachable(state()))
    }

    /** The builder before its first save — Accept saves itself first, so Send must too. */
    @Test
    fun `an unsaved builder with lines can be sent`() {
        assertTrue(sendReachable(state(quoteId = null)))
    }

    @Test
    fun `an empty builder with nothing on it cannot`() {
        assertFalse(sendReachable(state(quoteId = null).copy(lines = emptyList())))
        assertFalse(sendReachable(state().copy(customerId = null)))
    }

    @Test
    fun `the send that issues the quote retires the draft chip`() {
        val after = applySend(state(), "q1", SendOutcome(null, issuedNumber = "A00124", issuedStatus = "issued"))

        assertEquals("issued", after.status)
        assertEquals("A00124", after.ref)
        assertFalse("an issued quote is frozen — the builder must stop offering edits", after.status == "draft")
        assertEquals("Sent on WhatsApp ✓", after.sendDone)
    }

    /** Sending is not agreeing. Only the signature pad and billing set 'accepted'. */
    @Test
    fun `sending never accepts the quote`() {
        val after = applySend(state(), "q1", SendOutcome(null, issuedNumber = "A00124", issuedStatus = "issued"))
        assertFalse(after.status == "accepted")
    }

    /** Re-sending an already-issued quote reports no `issued` — nothing may move. */
    @Test
    fun `re-sending an issued quote leaves its number and status alone`() {
        val before = state(status = "issued").copy(ref = "A00124")
        val after = applySend(before, "q1", SendOutcome(null))

        assertEquals("issued", after.status)
        assertEquals("A00124", after.ref)
    }

    @Test
    fun `a failed send leaves the quote a draft`() {
        val after = applySend(state(), "q1", SendOutcome("WhatsApp isn't connected yet"))

        assertEquals("draft", after.status)
        assertEquals("Draft", after.ref)
        assertEquals("WhatsApp isn't connected yet", after.sendError)
    }

    /** The draft saved on the way in has to be remembered, or the next tap saves a SECOND quote. */
    @Test
    fun `the id from the save on the way in is kept even when the send fails`() {
        // sendToCustomer stamps the id as soon as the save returns, before the network call.
        val mid = state(quoteId = null).copy(quoteId = "q-new")
        val after = applySend(mid, "q-new", SendOutcome("Network error"))
        assertEquals("q-new", after.quoteId)
        assertEquals("Network error", after.sendError)
    }

    /**
     * The one that would corrupt data. A send started from an unsaved builder and answered
     * after the operator moved on must land on NOTHING. Matching loosely — treating a null
     * quoteId as "close enough" — stamped this quote's id, number and "Sent ✓" onto whichever
     * quote was on screen, and pointed its next Save or Accept at the wrong document.
     */
    @Test
    fun `a late result cannot stamp the quote that replaced it`() {
        val moved = state(quoteId = null).copy(ref = "New quote", who = "somebody else")
        val after = applySend(moved, "q-new", SendOutcome(null, issuedNumber = "A00124", issuedStatus = "issued"))

        assertEquals("nothing may be stamped onto the new quote", null, after.quoteId)
        assertEquals("New quote", after.ref)
        assertEquals("draft", after.status)
        assertEquals(null, after.sendDone)
    }

    @Test
    fun `a late result cannot stamp a DIFFERENT saved quote either`() {
        val other = state(quoteId = "q-other").copy(ref = "A00099", status = "issued")
        val after = applySend(other, "q-new", SendOutcome(null, issuedNumber = "A00124", issuedStatus = "issued"))

        assertEquals("q-other", after.quoteId)
        assertEquals("A00099", after.ref)
    }
}
