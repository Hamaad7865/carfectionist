package mu.carfection.pos.core.money

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Same cases as apps/web/src/lib/points.test.ts, same numbers — the parity gate diffs the
 * two suites, and a case present on one side only is drift.
 */
class PointsTest {

    // ── pointsEarned ─────────────────────────────────────────────────────────

    @Test
    fun `earns on the sale total at the shop rate — Rs 1,150 at 1 per Rs 100 is 11`() {
        assertEquals(11, pointsEarned(EarnInput(totalCents = 115_000L, pointsPaidCents = 0L, pointsPer100 = 1.0)))
    }

    @Test
    fun `ignores the share settled with points — the exclusion bites at the next rupee, not this one`() {
        // Same Rs 1,150 bill, Rs 50 of it already paid in points. Rs 1,100 earning at
        // 1 per Rs 100 is still 11 — the flooring doesn't move until Rs 1,200.
        assertEquals(11, pointsEarned(EarnInput(totalCents = 115_000L, pointsPaidCents = 5_000L, pointsPer100 = 1.0)))
    }

    @Test
    fun `rounds down — a part point is not a point`() {
        assertEquals(0, pointsEarned(EarnInput(totalCents = 9_900L, pointsPaidCents = 0L, pointsPer100 = 1.0)))
    }

    @Test
    fun `honours a rate above one`() {
        assertEquals(25, pointsEarned(EarnInput(totalCents = 100_000L, pointsPaidCents = 0L, pointsPer100 = 2.5)))
    }

    @Test
    fun `earns nothing on a bill settled entirely in points`() {
        assertEquals(0, pointsEarned(EarnInput(totalCents = 50_000L, pointsPaidCents = 50_000L, pointsPer100 = 1.0)))
    }

    @Test
    fun `a zero rate earns nothing, without throwing`() {
        assertEquals(0, pointsEarned(EarnInput(totalCents = 100_000L, pointsPaidCents = 0L, pointsPer100 = 0.0)))
    }

    @Test
    fun `a negative rate earns nothing, without throwing`() {
        assertEquals(0, pointsEarned(EarnInput(totalCents = 100_000L, pointsPaidCents = 0L, pointsPer100 = -1.0)))
    }

    // ── pointsToSpend ────────────────────────────────────────────────────────

    @Test
    fun `rounds up — the shop is never out of pocket for a fraction of a point`() {
        assertEquals(51, pointsToSpend(5_050L, 1.0))
    }

    @Test
    fun `honours a point worth more than a rupee`() {
        assertEquals(20, pointsToSpend(10_000L, 5.0))
    }

    // ── pointsValueCents ─────────────────────────────────────────────────────

    @Test
    fun `states what a balance is worth`() {
        assertEquals(12_000L, pointsValueCents(120, 1.0))
    }
}
