package mu.carfection.pos.core.data

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import mu.carfection.pos.core.hardware.ReceiptBiz
import mu.carfection.pos.core.network.ZReportDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 2026-10-19: Z000114 (no sales) printed "Closed by -" although Anshika closed it, and
 * stamped 13:12 for a 17:12 close. "Closed by" read the first cashier in the frozen totals
 * (nobody, on a no-sale day) and the time was the raw UTC string.
 */
class ZSlipClosedByTest {

    private val biz = ReceiptBiz(name = "Carfectionist", address = "Helvetia, 80840 Moka, MU", brn = "B", vatNo = "V")

    private fun z(cashier: String?, closedByName: String?) = ZReportDto(
        id = "z",
        number = "Z000114",
        scope = "day",
        totals = buildJsonObject {
            put("service_no", 1)
            put("float_initial", 2000.0)
            put("float_final", 2000.0)
            put("total_incl", 0.0)
            put("tickets", 0)
            putJsonArray("cashiers") {
                if (cashier != null) add(buildJsonObject { put("name", cashier); put("total", 100.0) })
            }
            putJsonObject("period") { put("total_incl", 0.0); put("tickets", 0) }
        },
        closedAt = "2026-10-19T13:12:04.235083+00:00",
        closedBy = "u-anshika",
        closedByName = closedByName,
    )

    @Test
    fun `a no-sale day still names the person who closed`() {
        val out = ZSlip.render(z(cashier = null, closedByName = "Anshika"), biz, 48)
        assertTrue(out, out.contains("Closed by Anshika"))
    }

    @Test
    fun `names the closer, not whoever rang the sales`() {
        val out = ZSlip.render(z(cashier = "Nick", closedByName = "Anshika"), biz, 48)
        assertTrue(out, out.contains("Closed by Anshika"))
        assertFalse(out, out.contains("Closed by Nick"))
    }

    @Test
    fun `prints the close time in Mauritius time`() {
        val out = ZSlip.render(z(cashier = null, closedByName = "Anshika"), biz, 48)
        assertTrue(out, out.contains("2026-10-19 17:12"))
        assertFalse(out, out.contains("13:12"))
    }

    @Test
    fun `an unparseable time falls back to the raw text`() {
        assertEquals("2026-09-25 13:21", ZSlip.muStamp("2026-09-25T13:21:38"))
    }
}
