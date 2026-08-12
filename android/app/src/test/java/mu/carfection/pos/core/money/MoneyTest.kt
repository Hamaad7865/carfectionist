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

    // ── computeDocTotals — the quote builder's mirror of the DB discount module ──

    private fun pctLine(qty: Double, unitCents: Long, pct: Double = 0.0, rate: Double = 15.0) =
        DocLineIn(qty, unitCents, "percent", pct, 0, rate)

    @Test
    fun `doc totals with no discount preserve the canonical vector`() {
        val t = computeDocTotals(
            listOf(pctLine(1.0, 32_000_00), pctLine(4.0, 3_800_00), pctLine(1.0, 30_000_00)),
            orderKind = null, orderPct = 0.0, orderAmtInclCents = 0,
        )
        assertEquals(77_200_00L, t.subtotalCents)
        assertEquals(11_580_00L, t.vatCents)
        assertEquals(88_780_00L, t.totalCents)
        assertEquals(0L, t.orderDiscountInclCents)
    }

    @Test
    fun `a line Rs discount is VAT-inclusive — divided back to the excl base`() {
        // 1 × 1000.00 @15%, Rs 115 off (incl) → excl 1000 − 115/1.15 = 900.00, VAT 135.00
        val t = computeDocTotals(
            listOf(DocLineIn(1.0, 1_000_00, "amount", 0.0, 115_00, 15.0)),
            null, 0.0, 0,
        )
        assertEquals(900_00L, t.lineExclCents[0])
        assertEquals(900_00L, t.subtotalCents)
        assertEquals(135_00L, t.vatCents)
        assertEquals(1_035_00L, t.totalCents)
    }

    @Test
    fun `a line Rs discount can never push the line negative`() {
        val t = computeDocTotals(listOf(DocLineIn(1.0, 100_00, "amount", 0.0, 999_99, 15.0)), null, 0.0, 0)
        assertEquals(0L, t.lineExclCents[0])
    }

    // ── price_includes_vat — the typed price IS the price (20260812000020) ──
    // Fixtures identical to scripts/_verify-typed-price.mjs, so all three engines
    // (SQL, this, allowance.ts) are held to the same numbers.

    @Test
    fun `a flagged 1000 lands on exactly 1000 — the reported bug`() {
        // Reported from the shop floor: typing 1000 produced 1000.01, because the typed
        // gross was squashed to a 2dp net (869.57) and re-grossed a cent off.
        val t = computeDocTotals(
            listOf(DocLineIn(1.0, 1_000_00, "percent", 0.0, 0, 15.0, priceInclusive = true)),
            null, 0.0, 0,
        )
        assertEquals(869_57L, t.lineExclCents[0])
        assertEquals(130_43L, t.lineVatCents[0]) // extracted, not added — that's what makes it exact
        assertEquals(130_43L, t.vatCents)
        assertEquals(1_000_00L, t.totalCents)
        // The row's own inclusive total (what the counter prints) IS the typed figure.
        assertEquals(1_000_00L, t.lineExclCents[0] + t.lineVatCents[0])
    }

    @Test
    fun `flagged qty and discounts stay exact`() {
        // 2 × 1000 at 10% off → flat 1800.00; 1000 minus Rs 50 → flat 950.00.
        val t = computeDocTotals(
            listOf(
                DocLineIn(2.0, 1_000_00, "percent", 10.0, 0, 15.0, priceInclusive = true),
                DocLineIn(1.0, 1_000_00, "amount", 0.0, 50_00, 15.0, priceInclusive = true),
            ),
            null, 0.0, 0,
        )
        assertEquals(2_750_00L, t.totalCents)
    }

    @Test
    fun `an unflagged line still adds VAT on top — history unchanged`() {
        // The old path, byte-for-byte: net 869.57 grosses to 1000.01.
        val t = computeDocTotals(listOf(pctLine(1.0, 869_57)), null, 0.0, 0)
        assertEquals(1_000_01L, t.totalCents)
    }

    @Test
    fun `order percent discount on the canonical vector`() {
        // gross incl 88,780.00 → 10% = 8,878.00 off; net incl 79,902.00 @15%
        // base = round(79,902/1.15) = 69,480.00; vat = 10,422.00
        val t = computeDocTotals(
            listOf(pctLine(1.0, 32_000_00), pctLine(4.0, 3_800_00), pctLine(1.0, 30_000_00)),
            "percent", 10.0, 0,
        )
        assertEquals(8_878_00L, t.orderDiscountInclCents)
        assertEquals(69_480_00L, t.subtotalCents)
        assertEquals(10_422_00L, t.vatCents)
        assertEquals(79_902_00L, t.totalCents)
    }

    @Test
    fun `order Rs discount clamps at the gross`() {
        val t = computeDocTotals(listOf(pctLine(1.0, 100_00)), "amount", 0.0, 999_999_99)
        assertEquals(115_00L, t.orderDiscountInclCents) // 100 + 15% VAT
        assertEquals(0L, t.totalCents)
    }

    @Test
    fun `order discount apportions exactly across mixed VAT rates`() {
        // Two rates; whatever the split, the applied discount and totals must sum exactly.
        val lines = listOf(pctLine(1.0, 1_000_00, rate = 15.0), pctLine(1.0, 333_33, rate = 0.0))
        val t = computeDocTotals(lines, "amount", 0.0, 100_00)
        assertEquals(100_00L, t.orderDiscountInclCents)
        val gross = 1_150_00L + 333_33L
        assertEquals(gross - 100_00L, t.totalCents) // total = gross − discount, to the cent
        assertEquals(t.subtotalCents + t.vatCents, t.totalCents)
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
