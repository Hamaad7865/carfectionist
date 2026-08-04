package mu.carfection.pos.feature.quote

import mu.carfection.pos.core.database.ProductEntity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Work on a car goes to the jobs board. Goods over the counter do not.
 *
 * Nothing could tell the two apart before: a catalogue line answers through its product,
 * but a hand-typed line carries no product at all, so the accept panel ticked "start the
 * work now" for a customer buying two bottles of sealant. The ad-hoc sheet now asks, and
 * this is the rule that reads the answer.
 */
class QuoteHasServiceTest {

    private fun product(id: String, kind: String) = ProductEntity(
        id = id, name = id, kind = kind, sellingPriceCents = 10_000L, vatRatePct = 15.0,
        barcode = null, isStocked = kind != "service", category = null, lowStockThreshold = null,
    )

    private val catalogue = listOf(product("svc", "service"), product("goods", "product"), product("cons", "consumable"))

    /** Mirrors QuoteViewModel.hasService — the DB uses the same coalesce. */
    private fun hasService(lines: List<QuoteLine>) = lines.any { l ->
        (l.lineKind ?: catalogue.firstOrNull { it.id == l.productId }?.kind ?: "service") == "service"
    }

    private fun line(productId: String? = null, kind: String? = null) =
        QuoteLine(productId, "line", "100", 15.0, lineKind = kind)

    @Test
    fun `a catalogue service is work`() {
        assertTrue(hasService(listOf(line(productId = "svc"))))
    }

    @Test
    fun `catalogue goods alone are not`() {
        assertFalse(hasService(listOf(line(productId = "goods"), line(productId = "cons"))))
    }

    @Test
    fun `a typed-in line is whatever the operator said`() {
        assertTrue(hasService(listOf(line(kind = "service"))))
        assertFalse(hasService(listOf(line(kind = "product"))))
    }

    /** The case that started this: goods from the catalogue plus a hand-typed bottle. */
    @Test
    fun `a hand-typed product does not turn a sale into a job`() {
        assertFalse(hasService(listOf(line(productId = "goods"), line(kind = "product"))))
    }

    @Test
    fun `one service anywhere is enough`() {
        assertTrue(hasService(listOf(line(productId = "goods"), line(kind = "product"), line(kind = "service"))))
    }

    /**
     * History: every ad-hoc line written before the sheet asked states nothing. Reading
     * those as goods would put the shop's back catalogue on the wrong side of the
     * decision — and an unraised job is work nobody is tracking, which is worse than a
     * job card dismissed in one tap.
     */
    @Test
    fun `an old line that states nothing is read as work`() {
        assertTrue(hasService(listOf(line())))
    }

    @Test
    fun `an empty quote has no work on it`() {
        assertFalse(hasService(emptyList()))
    }
}
