package mu.carfection.pos.core.money

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Same cases as apps/web/src/lib/money/allowance.test.ts, same numbers — the parity
 * gate (A12) diffs the two suites, and a case present on one side only is drift.
 */
class AllowanceTest {

    // Rs 1,000 ex-VAT at 15% = Rs 1,150 inclusive = 115_000 cents.
    private fun line(
        qty: Double = 1.0,
        unitCents: Long = 100_000L,
        vatRatePct: Double = 15.0,
        policy: DiscountPolicy = "free",
        discountKind: String = "percent",
        discountPct: Double = 0.0,
        discountAmountCents: Long = 0L,
    ) = AllowanceLineInput(qty, unitCents, vatRatePct, policy, discountKind, discountPct, discountAmountCents)

    // ── policyOf ──────────────────────────────────────────────────────────────

    @Test
    fun `lets an explicit product policy win`() {
        assertEquals("carwash", policyOf("carwash", "service"))
        assertEquals("free", policyOf("free", "service"))
    }

    @Test
    fun `derives from the kind when the product says inherit`() {
        assertEquals("none", policyOf("inherit", "service"))
        assertEquals("free", policyOf("inherit", "product"))
    }

    @Test
    fun `treats an unknown kind as a service — the safer default`() {
        assertEquals("none", policyOf(null, null))
    }

    // ── lineAllowanceCents ────────────────────────────────────────────────────

    @Test
    fun `gives a service nothing`() {
        assertEquals(0L, lineAllowanceCents(line(policy = "none")))
    }

    @Test
    fun `gives a carwash 5 percent of its gross`() {
        assertEquals(5_750L, lineAllowanceCents(line(policy = "carwash")))
    }

    @Test
    fun `gives goods the whole line`() {
        assertEquals(115_000L, lineAllowanceCents(line()))
    }

    // ── computeAllowance ──────────────────────────────────────────────────────

    @Test
    fun `sums a mixed document`() {
        assertEquals(115_000L, computeAllowance(listOf(line(policy = "none"), line()), null).ceilingCents)
    }

    @Test
    fun `does not count a carwash allowance as free`() {
        assertEquals(0L, computeAllowance(listOf(line(policy = "carwash")), null).freeCents)
    }

    @Test
    fun `reports exactly zero on an undiscounted document`() {
        assertEquals(0L, computeAllowance(listOf(line(qty = 3.0)), null).actualCents)
    }

    @Test
    fun `reports zero where a naive gross derivation would drift`() {
        // qty 1.25 at Rs 567.17. Two-step rounding gives Rs 815.30; the naive
        // round(qty*unit*1.15) gives 815.31 — a phantom cent on a line carrying
        // no discount at all, which would then demand a reason nobody owes.
        assertEquals(0L, computeAllowance(listOf(line(qty = 1.25, unitCents = 56_717L)), null).actualCents)
    }

    @Test
    fun `counts line and order discounts together`() {
        val r = computeAllowance(
            listOf(line(discountKind = "amount", discountAmountCents = 10_000L)),
            DocDiscount("amount", 5_000.0),
        )
        assertEquals(15_000L, r.actualCents)
    }

    @Test
    fun `knows when a reason is owed`() {
        val r = computeAllowance(listOf(line(policy = "carwash", discountPct = 5.0)), null)
        assertTrue(r.reasonRequired)
        assertFalse(r.overCeiling)
    }

    @Test
    fun `does not ask for a reason when goods cover the discount`() {
        assertFalse(computeAllowance(listOf(line(discountPct = 5.0)), null).reasonRequired)
    }

    @Test
    fun `flags a discount past the ceiling`() {
        assertTrue(computeAllowance(listOf(line(policy = "none", discountPct = 10.0)), null).overCeiling)
    }

    @Test
    fun `lets an owner-approved figure raise the ceiling, and no further`() {
        val over = listOf(line(policy = "none", discountPct = 10.0))
        assertFalse(computeAllowance(over, null, 11_500L).overCeiling)
        assertTrue(computeAllowance(over, null, 11_000L).overCeiling)
    }

    @Test
    fun `does not ask for a reason once an owner has approved`() {
        assertFalse(computeAllowance(listOf(line(policy = "carwash", discountPct = 5.0)), null, 5_750L).reasonRequired)
    }

    @Test
    fun `lets a carwash at exactly 5 percent sit on its ceiling, at any line count`() {
        // The bug this pins: the allowance used to be 5% OF THE GROSS, a cent less
        // than what a 5% discount actually removes once the discounted net and its
        // VAT are each rounded. One line hid inside the guard's 1-cent tolerance;
        // two did not — 135.02 against 135.00 — so a customer with two cars was
        // refused the discount the shop is expressly allowed to give.
        // TOUCHLESS FOAM WASH SEDAN: Rs 1,173.91 net, Rs 1,350.00 gross.
        for (n in listOf(1, 2, 3, 5)) {
            val lines = List(n) { line(unitCents = 117_391L, policy = "carwash", discountPct = 5.0) }
            val r = computeAllowance(lines, null)
            assertEquals("$n line(s) at 5% must land on the ceiling", r.ceilingCents, r.actualCents)
            assertFalse(r.overCeiling)
        }
    }

    @Test
    fun `still refuses a carwash above 5 percent`() {
        val r = computeAllowance(listOf(line(unitCents = 117_391L, policy = "carwash", discountPct = 6.0)), null)
        assertTrue(r.overCeiling)
    }
}
