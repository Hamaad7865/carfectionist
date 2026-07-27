package mu.carfection.pos.core.data

import mu.carfection.pos.core.hardware.ESC_BOLD_OFF
import mu.carfection.pos.core.hardware.ESC_BOLD_ON
import mu.carfection.pos.core.hardware.ReceiptBiz
import mu.carfection.pos.core.network.LocationNameDto
import mu.carfection.pos.core.network.ProductNameDto
import mu.carfection.pos.core.network.StockAdjustmentDto
import mu.carfection.pos.core.network.JobTechDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The printable stock-adjustment log.
 *
 * The owner hands this to a supplier with a return, files it against a count, or checks what
 * staff moved — so a line has to carry when, what, how much and why, the SIGN must survive,
 * and the footer has to state what the selection did to stock overall.
 */
class StockAdjustmentSlipTest {

    private val biz = ReceiptBiz(
        name = "Carfectionist", address = "Helvetia, 80840 Moka, MU",
        brn = "C22190760", vatNo = "VAT28070619", phone = null, logoFile = null,
        footer = "Thank you for visiting.",
    )

    private fun row(product: String, qty: Double, reason: String = "Received stock", who: String? = "ANSHIKA") =
        AdjustmentRow("id-$product-$qty", "27-07 11:42", product, qty, reason, "Shop", who)

    private fun render(rows: List<AdjustmentRow>, width: Int = 48) =
        StockAdjustmentSlip.render(rows, biz, width, "27-07-2026 12:30")

    private fun plain(s: String) = s.replace(ESC_BOLD_ON.toString(), "").replace(ESC_BOLD_OFF.toString(), "")

    @Test
    fun `the header says what the paper is and when it was run`() {
        val out = plain(render(listOf(row("Ultra Glass 500ml", 3.0))))
        assertTrue("title", out.contains("STOCK ADJUSTMENTS"))
        assertTrue("printed-at", out.contains("27-07-2026 12:30"))
        assertTrue("address split", out.contains("Helvetia") && out.contains("80840 Moka, MU"))
    }

    @Test
    fun `a line carries when, what, how much and why`() {
        val out = plain(render(listOf(row("Ultra Glass 500ml", 3.0, "Received stock"))))
        assertTrue("when", out.contains("27-07 11:42"))
        assertTrue("what", out.contains("Ultra Glass 500ml"))
        assertTrue("how much", out.contains("+3"))
        assertTrue("why", out.contains("Received stock"))
        assertTrue("where", out.contains("Shop"))
        assertTrue("who", out.contains("by ANSHIKA"))
    }

    /** The sign IS the information — a "1" that might be −1 is worse than no slip. */
    @Test
    fun `removals are signed and never read as additions`() {
        val out = plain(render(listOf(row("S40 350", -1.0, "Return to supplier"))))
        assertTrue("negative sign", out.contains("−1"))
        assertFalse("must not print a bare +1", out.contains("+1"))
    }

    @Test
    fun `the footer states what the selection did to stock`() {
        val out = plain(render(listOf(
            row("Ultra Glass 500ml", 3.0),
            row("S40 350", -1.0, "Return to supplier"),
            row("S50 090", -2.0, "Damaged"),
        )))
        assertTrue("count", out.contains("Adjustments") && out.contains("3"))
        assertTrue("received", out.contains("Units received") && out.contains("+3"))
        assertTrue("removed", out.contains("Units removed") && out.contains("−3"))
        assertTrue("net is zero here", out.contains("NET CHANGE") && out.contains("+0"))
    }

    @Test
    fun `a net loss reads as a loss`() {
        val out = plain(render(listOf(row("S40 350", -5.0, "Damaged"), row("S40 360", 2.0))))
        assertTrue(out.contains("NET CHANGE"))
        assertTrue("net −3", out.lines().any { it.contains("NET CHANGE") && it.contains("−3") })
    }

    /** Nothing may run off the roll at either paper width — long product names included. */
    @Test
    fun `no line overflows 58mm or 80mm paper`() {
        val rows = listOf(
            row("Meguiars Ultimate Quik Detailer Spray 650ml Refill", 12.0, "Received stock from the main supplier"),
            row("S40 350", -1.0),
        )
        for (w in listOf(32, 48)) {
            render(rows, w).lines().forEach {
                val p = plain(it)
                assertTrue("w=$w overflowed (${p.length}): $p", p.length <= w)
            }
        }
    }

    @Test
    fun `an empty selection prints a slip that says so rather than a blank roll`() {
        val out = plain(render(emptyList()))
        assertTrue(out.contains("Nothing selected"))
    }

    @Test
    fun `a movement with no reason recorded still reads as an adjustment`() {
        val d = StockAdjustmentDto(
            id = "m1", qty = -2.0, note = "  ", movedAt = "2026-07-27T07:42:00+00:00",
            products = ProductNameDto("S40 350"), location = LocationNameDto("Shop"), creator = null,
        )
        val r = adjustmentRow(d)
        assertEquals("Adjustment", r.reason)
        assertEquals("−2", r.qtyLabel)
        // Stamped UTC, shown in Mauritius time (UTC+4).
        assertEquals("27-07 11:42", r.whenLabel)
        // Older rows have no operator; the slip omits the line rather than inventing one.
        assertFalse(plain(render(listOf(r))).contains("by "))
    }

    @Test
    fun `the operator's role suffix is stripped, as it is on a receipt`() {
        val d = StockAdjustmentDto(
            id = "m2", qty = 1.0, movedAt = "2026-07-27T07:42:00+00:00",
            products = ProductNameDto("S40 350"), creator = JobTechDto("Anshika (Manager)"),
        )
        assertEquals("Anshika", adjustmentRow(d).who)
    }
}
