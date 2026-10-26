package mu.carfection.pos.core.data

import mu.carfection.pos.core.network.StockMoveDto
import mu.carfection.pos.core.network.StockOnHandDto
import kotlin.math.roundToLong

/**
 * How much was on the shelf right after each movement — the adjustment log's "→ N on hand".
 * Mirror of the web Inventory tab's "Stock after" column (apps/web/src/lib/stock/balance.ts):
 * on-hand IS the ledger summed, so the count after a movement is today's on-hand minus
 * everything that moved since. Walk the movements newest first, subtracting as you go.
 *
 * The web walks its own list because that list is every recent movement. The tablet log is
 * adjustments only, so the walk runs over [PosApi.fetchMovesSince] — every movement of the
 * logged products since the oldest log row — and the log rows are looked up in it by id.
 */
object StockBalance {

    /** Quantities are numeric(12,3): keep float noise (2.9999999) off the screen. */
    fun roundQty(n: Double): Double = (n * 1000).roundToLong() / 1000.0

    /**
     * Movement id → on hand at its location right after it.
     *
     * [moves] must be newest first in the server's fixed order (moved_at desc, id desc) and
     * hold every movement of a product newer than the rows asked about.
     *
     * A product/location with no on-hand row is left out rather than read as zero: the view is
     * the movements summed, so a pair that moved always has one, and its absence means the read
     * came back short (a session-less tablet gets [] with HTTP 200). No figure beats a
     * believable wrong one.
     */
    fun after(moves: List<StockMoveDto>, onHand: List<StockOnHandDto>): Map<String, Double> {
        val now = HashMap<Pair<String, String>, Double>()
        for (r in onHand) {
            val loc = r.locationId ?: continue
            now.merge(r.productId to loc, r.qtyOnHand, Double::plus)
        }
        val running = HashMap<Pair<String, String>, Double>()
        val out = HashMap<String, Double>()
        for (m in moves) {
            val key = m.productId to m.locationId
            val after = running[key] ?: now[key] ?: continue
            out[m.id] = roundQty(after)
            running[key] = roundQty(after - m.qty)
        }
        return out
    }
}
