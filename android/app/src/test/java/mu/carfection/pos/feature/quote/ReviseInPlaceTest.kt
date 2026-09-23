package mu.carfection.pos.feature.quote

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the builder may change, under in-place revise (20260910000110).
 *
 * Revise reopens the SAME quote — same row, same number — instead of forking a
 * new draft beside it. A draft is working paper and always editable; anything
 * else unlocks only once Revise has reopened it ([amending]), because the server
 * un-signs it first. Without that, an edit would silently move a price the
 * customer already agreed to.
 */
class ReviseInPlaceTest {

    @Test
    fun `a draft is always editable`() {
        assertTrue(quoteEditable(status = "draft", amending = false))
    }

    @Test
    fun `an issued quote is locked until revised`() {
        assertFalse(quoteEditable(status = "issued", amending = false))
    }

    @Test
    fun `an accepted quote is locked until revised`() {
        assertFalse(quoteEditable(status = "accepted", amending = false))
    }

    @Test
    fun `revise unlocks the issued quote in place`() {
        assertTrue(quoteEditable(status = "issued", amending = true))
    }

    @Test
    fun `revise unlocks the accepted quote in place`() {
        assertTrue(quoteEditable(status = "accepted", amending = true))
    }
}

/**
 * When the footer offers Update (quiet correction) over the accept ceremony.
 *
 * An agreement that already exists is never re-signed. Old forks carry it in
 * revisionOf; an in-place amend carries it in its kept signature.
 */
class ShowQuoteUpdateTest {

    @Test
    fun `an old fork still updates quietly`() {
        assertTrue(showQuoteUpdate(revisionOf = "parent-id", amending = false, signed = false, hasLiveBill = false))
    }

    @Test
    fun `an amended signed quote updates without ceremony`() {
        assertTrue(showQuoteUpdate(revisionOf = null, amending = true, signed = true, hasLiveBill = false))
    }

    @Test
    fun `an amend that was never agreed still needs its first signature`() {
        assertFalse(showQuoteUpdate(revisionOf = null, amending = true, signed = false, hasLiveBill = false))
    }

    @Test
    fun `a fresh draft goes through accept`() {
        assertFalse(showQuoteUpdate(revisionOf = null, amending = false, signed = false, hasLiveBill = false))
    }

    @Test
    fun `an amend under a live bill offers no update — the bill owns the price`() {
        assertFalse(showQuoteUpdate(revisionOf = null, amending = true, signed = true, hasLiveBill = true))
    }
}
