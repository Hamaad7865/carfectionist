package mu.carfection.pos.core.data

import mu.carfection.pos.core.network.StockLocationDto
import mu.carfection.pos.core.network.StockOnHandDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The POS must land on the same two ids the web resolves, or the surfaces disagree on stock. */
class StockLocationsTest {

    private val warehouse = StockLocationDto("loc-wh", "Warehouse", isDefault = true)
    private val shop = StockLocationDto("loc-shop", "Shop", isDefault = false)

    @Test
    fun `shop is the row named Shop`() {
        val l = resolveCounterLocations(listOf(warehouse, shop))
        assertEquals("loc-shop", l.shopId)
        assertEquals("loc-wh", l.warehouseId)
    }

    @Test
    fun `name wins over row order`() {
        val other = StockLocationDto("loc-van", "Van", isDefault = false)
        val l = resolveCounterLocations(listOf(warehouse, other, shop))
        assertEquals("loc-shop", l.shopId)
    }

    @Test
    fun `without a Shop row, the first non-default location stands in`() {
        val other = StockLocationDto("loc-van", "Van", isDefault = false)
        val l = resolveCounterLocations(listOf(warehouse, other))
        assertEquals("loc-van", l.shopId)
    }

    @Test
    fun `warehouse is the tenant default`() {
        val l = resolveCounterLocations(listOf(shop, warehouse))
        assertEquals("loc-wh", l.warehouseId)
    }

    @Test
    fun `without a default, the row named Warehouse stands in`() {
        val wh = StockLocationDto("loc-wh", "Warehouse", isDefault = false)
        val l = resolveCounterLocations(listOf(shop, wh))
        assertEquals("loc-wh", l.warehouseId)
    }

    /** Only a default location exists: no Shop id to pass, so the server picks its default. */
    @Test
    fun `a lone default location yields no shop id`() {
        val l = resolveCounterLocations(listOf(warehouse))
        assertNull(l.shopId)
        assertEquals("loc-wh", l.warehouseId)
    }

    @Test
    fun `no locations at all`() {
        val l = resolveCounterLocations(emptyList())
        assertNull(l.shopId)
        assertNull(l.warehouseId)
    }

    @Test
    fun `the sale deducts the shop when there is one`() {
        assertEquals("loc-shop", resolveCounterLocations(listOf(warehouse, shop)).saleLocationId)
    }

    /** Without a Shop, the server falls back to its default — the warning must read that shelf. */
    @Test
    fun `the sale deducts the default when there is no shop`() {
        assertEquals("loc-wh", resolveCounterLocations(listOf(warehouse)).saleLocationId)
    }

    // ── on-hand is read per shelf, never summed ──────────────────────────────────
    /** SAVORE CARD: nothing on the shop floor, 277 in the warehouse. Summing hid the shortfall. */
    private val savoreCard = listOf(
        StockOnHandDto("savore-card", "loc-shop", 0.0),
        StockOnHandDto("savore-card", "loc-wh", 277.0),
    )

    @Test
    fun `the shop shelf reports its own count, not the total`() {
        assertEquals(0, qtyAtLocation(savoreCard, "loc-shop")["savore-card"])
        assertEquals(277, qtyAtLocation(savoreCard, "loc-wh")["savore-card"])
    }

    @Test
    fun `a product absent from a shelf is absent from that map`() {
        val rows = listOf(StockOnHandDto("clip-b5", "loc-shop", 69.0))
        assertEquals(69, qtyAtLocation(rows, "loc-shop")["clip-b5"])
        assertNull(qtyAtLocation(rows, "loc-wh")["clip-b5"])
    }

    @Test
    fun `an unresolved location yields an empty shelf, not a wrong one`() {
        assertEquals(emptyMap<String, Int>(), qtyAtLocation(savoreCard, null))
    }

    /** The fallback when no shelf resolves: real totals, rather than a false stock-out. */
    @Test
    fun `totals sum every location`() {
        assertEquals(277, qtyEverywhere(savoreCard)["savore-card"])
    }
}
