package mu.carfection.pos.core.data

import mu.carfection.pos.core.network.StockMoveDto
import mu.carfection.pos.core.network.StockOnHandDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The adjustment log's "→ N on hand": what the shelf held right after each adjustment.
 * Same figure as the web Inventory ledger's "Stock after" (apps/web/src/lib/stock/balance.ts).
 */
class StockBalanceTest {

    private fun mv(id: String, product: String, loc: String, qty: Double) = StockMoveDto(id, product, loc, qty)
    private fun oh(product: String, loc: String, qty: Double) = StockOnHandDto(product, loc, qty)

    @Test
    fun `the newest movement gets today's on-hand`() {
        val after = StockBalance.after(listOf(mv("a", "p1", "shop", -1.0)), listOf(oh("p1", "shop", 5.0)))
        assertEquals(5.0, after.getValue("a"), 0.0)
    }

    @Test
    fun `a sale between two adjustments still counts, though the log never lists it`() {
        // newest first: adjustment −2, a SALE −1 (not in the log), adjustment +3
        val after = StockBalance.after(
            listOf(mv("adj2", "p1", "shop", -2.0), mv("sale", "p1", "shop", -1.0), mv("adj1", "p1", "shop", 3.0)),
            listOf(oh("p1", "shop", 6.0)),
        )
        assertEquals(6.0, after.getValue("adj2"), 0.0)
        assertEquals(9.0, after.getValue("adj1"), 0.0) // 6 + 2 back for adj2 + 1 back for the sale
    }

    @Test
    fun `each location keeps its own count`() {
        val after = StockBalance.after(
            listOf(mv("a", "p1", "shop", 2.0), mv("b", "p1", "wh", -2.0), mv("c", "p1", "shop", 1.0)),
            listOf(oh("p1", "shop", 4.0), oh("p1", "wh", 10.0)),
        )
        assertEquals(listOf(4.0, 10.0, 2.0), listOf("a", "b", "c").map { after.getValue(it) })
    }

    @Test
    fun `rows sharing a timestamp walk in the order the server sent them`() {
        // a stock count: same moved_at, ordered by id desc — the walk trusts that order as-is
        val after = StockBalance.after(
            listOf(mv("z", "p1", "shop", -1.0), mv("y", "p1", "shop", -1.0)),
            listOf(oh("p1", "shop", 3.0)),
        )
        assertEquals(3.0, after.getValue("z"), 0.0)
        assertEquals(4.0, after.getValue("y"), 0.0)
    }

    @Test
    fun `fractional quantities round to the ledger's 3 decimals`() {
        val after = StockBalance.after(
            listOf(mv("a", "p1", "shop", 0.1), mv("b", "p1", "shop", 0.2), mv("c", "p1", "shop", 0.1)),
            listOf(oh("p1", "shop", 0.7)),
        )
        assertEquals(listOf(0.7, 0.6, 0.4), listOf("a", "b", "c").map { after.getValue(it) })
    }

    @Test
    fun `no on-hand row means no figure, never a guessed zero`() {
        // a session-less read answers [] — the row must not claim the shelf is empty
        val after = StockBalance.after(listOf(mv("a", "p1", "shop", -1.0)), emptyList())
        assertFalse(after.containsKey("a"))
    }

    @Test
    fun `a log row the movement read never returned shows no figure`() {
        val after = StockBalance.after(listOf(mv("a", "p1", "shop", -1.0)), listOf(oh("p1", "shop", 2.0)))
        val row = AdjustmentRow("missing", "27-10 10:00", "Glass Cleaner", -1.0, "Correction", "Shop", null, after["missing"])
        assertNull(row.balanceLabel)
    }

    @Test
    fun `the label is a plain count — whole numbers bare, negatives with a real minus`() {
        fun label(b: Double) = AdjustmentRow("x", "", "", 1.0, "", null, null, b).balanceLabel
        assertEquals("14", label(14.0))
        assertEquals("2.5", label(2.5))
        assertEquals("−1", label(-1.0))
        assertEquals("0", label(0.0))
    }
}
