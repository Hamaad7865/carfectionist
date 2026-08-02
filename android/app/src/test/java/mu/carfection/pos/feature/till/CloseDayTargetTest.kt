package mu.carfection.pos.feature.till

import kotlinx.serialization.json.JsonObject
import mu.carfection.pos.core.network.ZReportDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * "Also seal the day" must close the day of the Z that `close_service` JUST cut — server
 * truth — never the session cached at screen entry. That cache can be a day stale (a tablet
 * left on the till screen overnight, the day closed from another device), and `close_day`
 * answers an already-closed day politely enough that a stale id used to "close" the wrong
 * day with no visible error.
 */
class CloseDayTargetTest {

    private fun z(dayId: String?) = ZReportDto(
        id = "z-1", number = "Z000123", scope = "service",
        tradingDayId = dayId, totals = JsonObject(emptyMap()),
    )

    @Test
    fun `seals the day the just-cut Z belongs to`() {
        assertEquals("day-B", dayToSeal(justCutZ = z("day-B"), alsoDay = true))
    }

    @Test
    fun `only closing the service seals no day`() {
        assertNull(dayToSeal(justCutZ = z("day-B"), alsoDay = false))
    }

    @Test
    fun `a Z that carries no day seals no day`() {
        assertNull(dayToSeal(justCutZ = z(null), alsoDay = true))
    }
}
