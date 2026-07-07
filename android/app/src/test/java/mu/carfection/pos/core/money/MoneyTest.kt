package mu.carfection.pos.core.money

import org.junit.Assert.assertEquals
import org.junit.Test

class MoneyTest {

    /** The canonical Phase-1 vector — all three clients (DB, web, POS) must agree. */
    @Test
    fun `the 88,780 quote`() {
        val t = computeTotals(
            listOf(
                LineInput(qty = 1.0, unitCents = 32_000_00, vatRatePct = 15.0),
                LineInput(qty = 4.0, unitCents = 3_800_00, vatRatePct = 15.0),
                LineInput(qty = 1.0, unitCents = 30_000_00, vatRatePct = 15.0),
            ),
        )
        assertEquals(77_200_00L, t.subtotalCents)
        assertEquals(11_580_00L, t.vatCents)
        assertEquals(88_780_00L, t.totalCents)
    }

    @Test
    fun `line rounding is half away from zero at line level`() {
        // 3 × 33.33 = 99.99 excl; VAT 15% = 14.9985 → 15.00 (half up)
        val t = computeTotals(listOf(LineInput(3.0, 33_33, 0.0, 15.0)))
        assertEquals(99_99L, t.lines[0].exclCents)
        assertEquals(15_00L, t.lines[0].vatCents)
    }

    @Test
    fun `discount applies before rounding`() {
        // 1 × 1000.00 − 12.5% = 875.00; VAT 15% = 131.25
        val t = computeTotals(listOf(LineInput(1.0, 1_000_00, 12.5, 15.0)))
        assertEquals(875_00L, t.subtotalCents)
        assertEquals(131_25L, t.vatCents)
    }

    @Test
    fun formatting() {
        assertEquals("Rs 88,780.00", formatMUR(88_780_00))
        assertEquals("Rs 0.50", formatMUR(50))
        assertEquals("-Rs 1,234.05", formatMUR(-1_234_05))
    }

    @Test
    fun parsing() {
        assertEquals(1_706_50L, parseMoneyToCents("1706.5"))
        assertEquals(2_000_00L, parseMoneyToCents("2,000"))
        assertEquals(null, parseMoneyToCents("abc"))
    }
}
