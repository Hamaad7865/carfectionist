package mu.carfection.pos.feature.quote

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * When the tablet may still offer Revise.
 *
 * The rule has to agree with revise_quote, because the button is only a door onto that RPC:
 * offering it where the RPC refuses gives the counter an error instead of an answer. And it
 * takes TWO checks that look redundant and are not — the case that went wrong in the shop
 * (A00179, billed as INV-0204 and then revised) is caught by the second, while every
 * ordinary counter sale is caught only by the first.
 */
class CanReviseQuoteTest {

    @Test
    fun `an unbilled quote can be revised`() {
        assertTrue(canReviseQuote(billed = false, supersededCount = 0))
    }

    /**
     * The gap that a passing warning-banner test would have hidden. superseded_bills leaves
     * a quote's OWN bill out of its count on purpose — that is the ordinary shape of a
     * counter sale, not something to warn about — so this check cannot be folded into it.
     * Without `billed`, every billed counter quote would show a Revise button that errors.
     */
    @Test
    fun `a quote billed at the counter cannot be revised`() {
        assertFalse(canReviseQuote(billed = true, supersededCount = 0))
    }

    /** INV-0204: the bill hangs off the quote this one replaced, and is on no screen. */
    @Test
    fun `a bill left standing by an earlier revision blocks it`() {
        assertFalse(canReviseQuote(billed = false, supersededCount = 1))
    }

    @Test
    fun `both at once still refuses`() {
        assertFalse(canReviseQuote(billed = true, supersededCount = 2))
    }
}
