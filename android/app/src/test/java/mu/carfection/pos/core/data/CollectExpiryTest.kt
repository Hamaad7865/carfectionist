package mu.carfection.pos.core.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * When a latched collect request is too old to open the pad for.
 *
 * A deposit agreed at signing is collected the same shift. Without an expiry a request
 * latched before lunch would spring the pad open on whoever next visits Checkout — over
 * a bill nobody has looked at for hours — so anything older than a shift is re-selected
 * manually from TO COLLECT instead. Expiry still consumes the latch; that half lives in
 * the counter's watcher, not here.
 */
class CollectExpiryTest {

    private val now = 1_700_000_000_000L

    @Test
    fun `a fresh request opens the pad`() {
        assertFalse(isCollectRequestExpired(now, now))
        assertFalse(isCollectRequestExpired(now - 60_000, now))
    }

    @Test
    fun `a request just past four hours is expired`() {
        assertTrue(isCollectRequestExpired(now - COLLECT_REQUEST_TTL_MS - 1, now))
    }

    @Test
    fun `a request exactly at the boundary still counts as live`() {
        assertFalse(isCollectRequestExpired(now - COLLECT_REQUEST_TTL_MS, now))
    }

    @Test
    fun `a request from the future reads as fresh, not expired`() {
        assertFalse(isCollectRequestExpired(now + 60_000, now))
    }

    @Test
    fun `four hours is a shift`() {
        assertTrue(COLLECT_REQUEST_TTL_MS == 4L * 60 * 60 * 1000)
    }
}
