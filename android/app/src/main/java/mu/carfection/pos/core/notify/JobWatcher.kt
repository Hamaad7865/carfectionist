package mu.carfection.pos.core.notify

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.sync.ConnectivityObserver
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The board's ears. One app-scoped watcher, following the same shape as OutboxRepository:
 * a long-lived scope that wakes on connectivity.
 *
 * Two jobs, and only two:
 *   1. Keep the clock-driven alarms honest. Every time a job changes — booked, started,
 *      paused, re-estimated — re-arm from what is now true. A paused job's ETA slides;
 *      an alarm armed against the old one would fire into thin air.
 *   2. Announce a car going READY. That is an event, not a time: a technician marks it on
 *      one tablet and the front desk must hear it on another. No alarm can predict it.
 *
 * Realtime only runs while the process lives. That is honest for a shop-floor tablet that
 * sits open all day, and the alarms — which do survive — carry the time-based alerts.
 */
@Singleton
class JobWatcher @Inject constructor(
    private val supabase: SupabaseClient,
    private val api: PosApi,
    private val alarms: JobAlarms,
    private val notifications: JobNotifications,
    private val alertLog: AlertLog,
    private val connectivity: ConnectivityObserver,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var started = false

    /** Called once the operator is signed in — before that there is no tenant to listen for. */
    @Synchronized
    fun start() {
        if (started) return
        started = true
        notifications.ensureChannel()

        // Arm from the server whenever the line comes back, and once at startup: alarms
        // are lost to reboots and reinstalls, and a job booked on another device is one we
        // have never seen.
        scope.launch {
            connectivity.online.collect { online -> if (online) rearmAll() }
        }
        scope.launch { listen() }
    }

    private suspend fun rearmAll() {
        runCatching { api.fetchAlertableJobs() }.onSuccess { alarms.armAll(it) }
    }

    private suspend fun listen() {
        while (true) {
            runCatching {
                val channel = supabase.channel("jobs-watch")
                val changes = channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                    table = "jobs"
                }
                channel.subscribe(blockUntilSubscribed = true)

                changes.onEach { action ->
                    val row = when (action) {
                        is PostgresAction.Update -> action.record
                        is PostgresAction.Insert -> action.record
                        else -> null
                    } ?: return@onEach
                    onJobChanged(row, wasReady = (action as? PostgresAction.Update)?.oldRecord?.isReady() ?: false)
                }.collect()
            }
            // The socket dies on every tunnel, lift and Wi-Fi hiccup. Reconnect rather than
            // leaving the front desk silently un-notified for the rest of the day.
            delay(RETRY_MS)
        }
    }

    private fun JsonObject.isReady(): Boolean =
        runCatching { this["status"]?.jsonPrimitive?.content }.getOrNull() == "ready"

    private fun JsonObject.jobId(): String? =
        runCatching { this["id"]?.jsonPrimitive?.content }.getOrNull()

    private suspend fun onJobChanged(row: JsonObject, wasReady: Boolean) {
        val id = row.jobId() ?: return
        // The row on the wire is a raw record; re-read through the API so the vehicle and
        // customer names the notification needs come with it, and so the state we act on is
        // the server's, not a snapshot that may already be stale.
        val job = runCatching { api.fetchJobForAlert(id) }.getOrNull() ?: return

        alarms.arm(job)

        // Only on the edge into ready — a later touch of an already-ready job (dismissing it
        // from the board, billing it) must not ring the bell a second time. AlertLog is the
        // belt to this pair of braces.
        if (!wasReady && row.isReady()) notifications.post(job, JobAlert.READY)

        // The car has gone home: drop its alerts so the log cannot grow forever.
        if (job.deliveredAt != null || job.status == "cancelled") alertLog.forget(id)
    }

    private companion object {
        const val RETRY_MS = 5_000L
    }
}
