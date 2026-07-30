package mu.carfection.pos.core.sync

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The periodic catalogue sync: prices corrected in the back office must reach an open,
 * online tablet on their own — the bug this pins was a shelf price the web had fixed
 * hours earlier still ringing up at the stale figure because nothing ever re-pulled.
 */
class CatalogSyncTest {

    private val interval = 5 * 60_000L

    @Test
    fun `pulls immediately when signed in and online, then on every tick`() = runTest {
        val logged = MutableStateFlow<Boolean?>(null)
        val online = MutableStateFlow(false)
        var pulls = 0
        val job = launch { runCatalogSync(catalogSyncActive(logged, online), interval) { pulls++ } }

        runCurrent()
        assertEquals("nothing runs before login resolves", 0, pulls)

        logged.value = true; online.value = true; runCurrent()
        assertEquals("first pull is immediate, not one interval late", 1, pulls)

        advanceTimeBy(interval); runCurrent()
        assertEquals(2, pulls)
        advanceTimeBy(interval); runCurrent()
        assertEquals(3, pulls)

        job.cancel()
    }

    @Test
    fun `never pulls while offline, catches up the moment connectivity returns`() = runTest {
        val logged = MutableStateFlow<Boolean?>(true)
        val online = MutableStateFlow(true)
        var pulls = 0
        val job = launch { runCatalogSync(catalogSyncActive(logged, online), interval) { pulls++ } }
        runCurrent()
        assertEquals(1, pulls)

        online.value = false; runCurrent()
        advanceTimeBy(interval * 10); runCurrent()
        assertEquals("an offline tablet attempts nothing", 1, pulls)

        online.value = true; runCurrent()
        assertEquals("reconnect pulls NOW — the offline morning's prices are stale", 2, pulls)

        job.cancel()
    }

    @Test
    fun `sign-out stops the loop, next login starts fresh`() = runTest {
        val logged = MutableStateFlow<Boolean?>(true)
        val online = MutableStateFlow(true)
        var pulls = 0
        val job = launch { runCatalogSync(catalogSyncActive(logged, online), interval) { pulls++ } }
        runCurrent()
        assertEquals(1, pulls)

        logged.value = false; runCurrent()
        advanceTimeBy(interval * 3); runCurrent()
        assertEquals("no pulls for a signed-out terminal", 1, pulls)

        logged.value = true; runCurrent()
        assertEquals(2, pulls)

        job.cancel()
    }

    @Test
    fun `a failed pull does not kill the loop`() = runTest {
        val logged = MutableStateFlow<Boolean?>(true)
        val online = MutableStateFlow(true)
        var attempts = 0
        val job = launch {
            runCatalogSync(catalogSyncActive(logged, online), interval) {
                attempts++
                if (attempts == 1) error("supabase hiccup")
            }
        }
        runCurrent()
        assertEquals(1, attempts)

        advanceTimeBy(interval); runCurrent()
        assertEquals("the tick after a failure still fires", 2, attempts)

        job.cancel()
    }

    @Test
    fun `an online flap mid-pull cancels and restarts rather than stacking loops`() = runTest {
        val logged = MutableStateFlow<Boolean?>(true)
        val online = MutableStateFlow(true)
        var pulls = 0
        val job = launch { runCatalogSync(catalogSyncActive(logged, online), interval) { pulls++ } }
        runCurrent()

        online.value = false; runCurrent()
        online.value = true; runCurrent()
        online.value = false; runCurrent()
        online.value = true; runCurrent()
        assertEquals("each reopen pulls once — 1 initial + 2 reconnects", 3, pulls)

        // Only ONE loop must survive the flapping: exactly one pull per interval.
        advanceTimeBy(interval); runCurrent()
        assertEquals(4, pulls)
        advanceTimeBy(interval); runCurrent()
        assertEquals(5, pulls)

        job.cancel()
    }
}
