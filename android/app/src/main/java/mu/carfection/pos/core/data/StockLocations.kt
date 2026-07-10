package mu.carfection.pos.core.data

import mu.carfection.pos.core.network.StockLocationDto
import mu.carfection.pos.core.network.StockOnHandDto

/** The two locations the counter reasons about: what a sale draws down, and where restock sits. */
data class CounterLocations(val shopId: String?, val warehouseId: String?) {
    /**
     * The shelf the sale will actually deduct. Passing a null shop id makes the server
     * fall back to its default location, which is the Warehouse — so the warning has to
     * read that same shelf, or a tenant without a Shop row would warn on every tap.
     */
    val saleLocationId: String? get() = shopId ?: warehouseId
}

/**
 * Counter sales draw from the Shop — the walk-in front — not the Warehouse default.
 *
 * Resolved exactly as the web resolves it, so both surfaces deduct the same shelf:
 * the Shop is the row named "Shop", else the first non-default row; the Warehouse is
 * the tenant default, else the row named "Warehouse". A null [CounterLocations.shopId]
 * means "pass nothing and let the server fall back to its default location".
 */
fun resolveCounterLocations(rows: List<StockLocationDto>): CounterLocations = CounterLocations(
    shopId = (rows.firstOrNull { it.name == SHOP } ?: rows.firstOrNull { !it.isDefault })?.id,
    warehouseId = (rows.firstOrNull { it.isDefault } ?: rows.firstOrNull { it.name == WAREHOUSE })?.id,
)

/**
 * On-hand per product at ONE location. Rows for every other location are dropped —
 * summing them is what let a sale off an empty shelf slip past the warning.
 * A null [locationId] resolves nothing, so callers get an empty shelf, not a wrong one.
 */
fun qtyAtLocation(rows: List<StockOnHandDto>, locationId: String?): Map<String, Int> =
    if (locationId == null) emptyMap()
    else rows.filter { it.locationId == locationId }
        .groupBy { it.productId }
        .mapValues { (_, r) -> r.sumOf { it.qtyOnHand }.toInt() }

/**
 * Total on-hand across every location. Only for when the shelves can't be told apart:
 * showing real totals beats a screen of false "Out of stock" that warns on every tap.
 */
fun qtyEverywhere(rows: List<StockOnHandDto>): Map<String, Int> =
    rows.groupBy { it.productId }.mapValues { (_, r) -> r.sumOf { it.qtyOnHand }.toInt() }

private const val SHOP = "Shop"
private const val WAREHOUSE = "Warehouse"
