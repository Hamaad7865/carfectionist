package mu.carfection.pos.core.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which server refusals are DEFINITIVE. The web mirrors this list at
 * apps/web/src/features/counter/settle.ts — the two must stay in step.
 *
 * Reading a definitive refusal as a lost response costs twice over: at the till it freezes
 * the basket behind "couldn't confirm the sale reached the server" and the cashier retries a
 * request the server will refuse forever; in the outbox (OfflineSaleRepository.drain) it
 * leaves the sale PENDING and hammers the same refusal instead of marking it BLOCKED for a
 * human to look at.
 */
class DeterministicRejectionTest {

    private fun refusal(message: String) = RuntimeException(message)

    /** app.assert_discount_allowed, raised from inside issue_document. Nothing committed. */
    @Test
    fun `a discount over the ceiling is definitive`() {
        assertTrue(
            isDeterministicRejection(
                refusal("discount exceeds allowance: Rs 1,200.00 requested, Rs 350.00 allowed"),
            ),
        )
    }

    @Test
    fun `a carwash discount with no reason is definitive`() {
        assertTrue(isDeterministicRejection(refusal("a reason is required for a carwash discount")))
    }

    /** The clamp does not make these unreachable: an offline sale replays against a catalogue
     *  that may have changed its policy since the sale was rung up. */
    @Test
    fun `the day gate is still definitive`() {
        assertTrue(isDeterministicRejection(refusal("the day is closed — no more entries are possible")))
    }

    /** A genuine lost response must keep the uncertain-retry flow — it may have committed. */
    @Test
    fun `a lost network response is not definitive`() {
        assertFalse(isDeterministicRejection(refusal("failed to connect to /10.0.2.2 (port 443)")))
    }

    /** Catalogue references baked into an offline capture that the server no longer knows. */
    @Test
    fun `an unknown product or location is definitive`() {
        assertTrue(isDeterministicRejection(refusal("unknown product on a line")))
        assertTrue(isDeterministicRejection(refusal("unknown stock location")))
        assertTrue(isDeterministicRejection(refusal("no stock location — set a default location or pass one")))
    }

    /** Tender arithmetic refused before anything committed — retrying changes nothing. */
    @Test
    fun `a refused tender amount is definitive`() {
        assertTrue(isDeterministicRejection(refusal("payment amount must be positive")))
        assertTrue(isDeterministicRejection(refusal("tendered is less than amount")))
    }

    /** Points programme refusals: the balance/switch answer only a person can resolve. */
    @Test
    fun `a points refusal is definitive`() {
        assertTrue(isDeterministicRejection(refusal("a points payment needs a customer on the bill")))
        assertTrue(isDeterministicRejection(refusal("not enough points: 500 needed, 120 available")))
        assertTrue(isDeterministicRejection(refusal("points are switched off")))
    }
}
