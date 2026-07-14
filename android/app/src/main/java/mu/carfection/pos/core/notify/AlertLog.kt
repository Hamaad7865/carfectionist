package mu.carfection.pos.core.notify

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringSetPreferencesKey
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What we have already said out loud.
 *
 * Alarms are re-armed on every reconnect, every reboot and every reinstall, and the
 * realtime socket redelivers on reconnect. Without a memory, the same car would be
 * announced as ready twice — and an alert that repeats itself is one staff stop reading.
 *
 * Persisted, because the process dies more often than the working day ends.
 */
@Singleton
class AlertLog @Inject constructor(
    private val prefs: DataStore<Preferences>,
) {
    private val key = stringSetPreferencesKey("job_alerts_fired")

    /** True the first time this job+kind is claimed, false every time after. */
    suspend fun claim(jobId: String, alert: JobAlert): Boolean {
        val entry = "$jobId:${alert.id}"
        var fresh = false
        prefs.edit { p ->
            val seen = p[key] ?: emptySet()
            fresh = entry !in seen
            if (fresh) p[key] = seen + entry
        }
        return fresh
    }

    /**
     * A job that has left the board takes its alerts with it. Called when a job is
     * delivered or cancelled, so the set cannot grow without bound across the years —
     * and so a re-used estimate on a re-opened job can speak again.
     */
    suspend fun forget(jobId: String) {
        prefs.edit { p ->
            val seen = p[key] ?: return@edit
            p[key] = seen.filterNot { it.startsWith("$jobId:") }.toSet()
        }
    }

    suspend fun seen(): Set<String> = prefs.data.first()[key] ?: emptySet()
}
