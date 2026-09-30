package mu.carfection.pos.core.data

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import mu.carfection.pos.core.hardware.ReceiptBiz
import mu.carfection.pos.core.network.ZReportDto
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 2026-09-25: Z000088 printed Service 1 + 3 only (7 tickets Rs 57,969) while its
 * Period said 9 tickets Rs 60,119 — Service 2 (back-office, still open) was
 * omitted from services[]. The server now includes open sessions as provisional
 * blocks; the slip must print them as "still open" with no counted drawer lines
 * (never a misleading Rs 0.00), so the breakdown reconciles with the Period.
 */
class ZSlipOpenServiceTest {

    private val biz = ReceiptBiz(name = "Carfectionist", address = "Helvetia, 80840 Moka, MU", brn = "B", vatNo = "V")

    private fun service(no: Int, total: Double, tickets: Int, open: Boolean) = buildJsonObject {
        put("service_no", no)
        put("device", if (no == 2) "back-office" else "TAB-84A1")
        put("status", if (open) "open" else "closed")
        put("provisional", open)
        put("float_initial", if (no == 2) 0.0 else 2000.0)
        if (open) put("float_final", JsonNull) else put("float_final", if (no == 2) 0.0 else 2000.0)
        if (open) put("counted_cash", JsonNull) else put("counted_cash", if (no == 2) 0.0 else 2000.0)
        if (open) put("variance", JsonNull) else put("variance", 0.0)
        put("voided_bills", 0)
        put("total_incl", total)
        put("tickets", tickets)
        put("avg_basket", if (tickets > 0) total / tickets else 0.0)
    }

    private fun z(): ZReportDto {
        val totals = buildJsonObject {
            put("service_no", 3)
            put("total_incl", 2804.99)
            putJsonArray("services") {
                add(service(1, 55164.01, 5, open = false))
                add(service(2, 2150.00, 2, open = true))
                add(service(3, 2804.99, 2, open = false))
            }
            putJsonObject("period") {
                put("total_incl", 60119.00)
                put("tickets", 9)
                put("avg_basket", 7514.88)
                putJsonArray("methods") {}
                putJsonArray("categories") {}
                putJsonArray("cashiers") {}
                putJsonArray("vat") {}
            }
        }
        return ZReportDto(id = "z", number = "Z000088", scope = "service", totals = totals, closedAt = "2026-09-25T13:21:38")
    }

    @Test
    fun `an open service prints as still open, not as a counted drawer`() {
        val out = ZSlip.render(z(), biz, 48)
        assertTrue("open block labelled", out.contains("Service 2 (still open)"))
        assertTrue("provisional marker", out.contains("Still open"))
        assertTrue("open sales still listed", out.contains("2,150.00"))
    }

    @Test
    fun `no misleading zero float or counted lines inside the open block`() {
        val out = ZSlip.render(z(), biz, 48)
        val at = out.indexOf("Service 2 (still open)")
        val next = out.indexOf("Service 3", at + 1)
        val block = out.substring(at, if (next > 0) next else out.length)
        assertFalse("no zero final float in open block", block.contains("Final cash float"))
        assertFalse("no counted line in open block", block.contains("Counted"))
    }

    @Test
    fun `closed blocks keep their counted lines`() {
        val out = ZSlip.render(z(), biz, 48)
        val at = out.indexOf("Service 1")
        val next = out.indexOf("Service 2", at + 1)
        val block = out.substring(at, next)
        assertTrue("closed block keeps counted", block.contains("Counted"))
    }
}
