package mu.carfection.pos.core.sync

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * When should the tablet keep its catalogue fresh on its own? Exactly while a signed-in
 * operator has a validated network. `null` login (still resolving at app start) counts
 * as OFF — syncing before the tenant is known would pull nothing useful.
 */
fun catalogSyncActive(loggedIn: Flow<Boolean?>, online: Flow<Boolean>): Flow<Boolean> =
    combine(loggedIn, online) { l, o -> l == true && o }.distinctUntilChanged()

/**
 * The periodic catalogue pull. Prices corrected in the back office must reach an open
 * tablet without anyone tapping Sync — the counter once rang up Rs 1,505 for a product
 * the web had re-priced to Rs 1,309 hours earlier, because nothing ever re-pulled.
 *
 * Pull-FIRST, then wait: the gate opening (login, or connectivity returning after an
 * outage) refreshes immediately, so an offline morning's stale prices don't get a
 * further [intervalMs] of grace. `collectLatest` cancels an in-flight pull when the
 * gate closes and guarantees a single loop however often the network flaps.
 */
suspend fun runCatalogSync(active: Flow<Boolean>, intervalMs: Long, pull: suspend () -> Unit) {
    active.collectLatest { on ->
        if (on) while (true) {
            // One failed pull (a Supabase hiccup) must not end freshness for the day.
            try {
                pull()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
            }
            delay(intervalMs)
        }
    }
}
