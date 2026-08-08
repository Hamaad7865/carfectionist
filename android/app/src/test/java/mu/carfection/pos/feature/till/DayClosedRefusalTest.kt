package mu.carfection.pos.feature.till

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "Reopen the day" is offered on exactly one refusal: the day was sealed. Every other way
 * the till can refuse has a different fix, and offering a reopen for those sends the
 * cashier down a road that cannot help them — worse than showing nothing, because it
 * looks like the answer.
 *
 * The strings are the servers' own, copied verbatim from the migrations that raise them.
 */
class DayClosedRefusalTest {

    @Test
    fun `the sealed-day refusal offers the reopen`() {
        // app.open_trading_day, 20260714000004_cashmag_close.sql:129 — carries the date.
        assertTrue(isDayClosed("the day of 2026-08-08 is closed — reopen it before taking any more money"))
    }

    @Test
    fun `a till left open since yesterday does not`() {
        // app.assert_till_day_current — the fix is to close that service, not reopen a day.
        assertFalse(
            isDayClosed(
                "this till is still on the day of 2026-08-07 — close that service on the till, " +
                    "then open a new one, before taking today's money",
            ),
        )
    }

    @Test
    fun `a mid-sale day-closed refusal does not`() {
        // app.assert_day_open — fires on the counter, where this button does not exist.
        assertFalse(isDayClosed("the day is closed — no more entries or transactions are possible"))
    }

    @Test
    fun `an already-open till does not`() {
        assertFalse(isDayClosed("this till is already open"))
    }

    @Test
    fun `a quotation-only device does not`() {
        assertFalse(isDayClosed("this device does not take payments — open the till on the paying terminal"))
    }

    @Test
    fun `an uncounted float does not`() {
        assertFalse(isDayClosed("count the opening float before opening the till"))
    }

    @Test
    fun `no error at all offers nothing`() {
        assertFalse(isDayClosed(null))
        assertFalse(isDayClosed(""))
    }
}
