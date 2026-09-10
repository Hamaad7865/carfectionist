package mu.carfection.pos.feature.quote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The stored booking intent has to survive the round trip: picked at signing,
 * read back when the customer returns. Anything unparseable must read as
 * "nothing agreed" — an empty picker the operator can set — never a crash and
 * never a silently dropped booking (JOB-a73c: scheduled, no time, no deposit).
 */
class BookingIntentTest {

    @Test
    fun `no stored date stays unset`() {
        assertNull(parseBookForAt(null))
    }

    @Test
    fun `a stored date parses to the same moment`() {
        assertEquals(1789122600000L, parseBookForAt("2026-09-11T10:30:00Z"))
    }

    @Test
    fun `a garbled date reads as unset, not a crash`() {
        assertNull(parseBookForAt("tomorrow-ish"))
    }

    @Test
    fun `no stored deposit reads as none`() {
        assertEquals(0L, parseDepositDueCents(0.0))
    }

    @Test
    fun `a stored deposit parses to till cents`() {
        assertEquals(123750L, parseDepositDueCents(1237.5))
    }

    @Test
    fun `a negative deposit reads as none`() {
        assertEquals(0L, parseDepositDueCents(-50.0))
    }
}
