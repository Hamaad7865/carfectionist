package mu.carfection.pos.core.notify

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import dagger.hilt.android.qualifiers.ApplicationContext
import mu.carfection.pos.core.jobs.JobClock
import mu.carfection.pos.core.network.JobBoardDto
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Arms the clock-driven alerts. Three of the four alerts are known in advance — a job
 * is due at its booked minute, overdue a quarter of an hour later, late once it passes
 * its estimate — so each is an exact alarm rather than something we have to stay awake
 * polling for. (The fourth, READY, is an event caused by another person on another
 * device; no alarm can predict it. JobWatcher hears that one over realtime.)
 *
 * The alarm carries nothing but a job id and a kind. When it fires, JobAlarmReceiver
 * re-reads the job from the server and decides then — see the note there on why.
 */
@Singleton
class JobAlarms @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val am = context.getSystemService(AlarmManager::class.java)

    /** How long after its slot an unstarted job is nagged about. */
    private val overdueGraceMs = 15 * 60_000L

    /**
     * Re-arm everything for the jobs we know about. Cheap and idempotent: alarms are
     * keyed by job+kind, so re-arming replaces rather than duplicates. Called on login,
     * on every realtime change, and after a reboot.
     */
    fun armAll(jobs: List<JobBoardDto>, nowMs: Long = System.currentTimeMillis()) {
        for (j in jobs) arm(j, nowMs)
    }

    fun arm(job: JobBoardDto, nowMs: Long = System.currentTimeMillis()) {
        // A finished job has nothing left to warn about.
        if (job.readyAt != null || job.deliveredAt != null || job.status == "cancelled") {
            cancel(job.id)
            return
        }

        val scheduled = JobClock.epoch(job.scheduledAt)
        if (job.status == "scheduled" && scheduled != null) {
            set(job.id, JobAlert.DUE, scheduled, nowMs)
            set(job.id, JobAlert.OVERDUE, scheduled + overdueGraceMs, nowMs)
        } else {
            // Started (or unscheduled): the start alerts can no longer apply.
            cancel(job.id, JobAlert.DUE)
            cancel(job.id, JobAlert.OVERDUE)
        }

        val eta = JobClock.estimatedFinishMs(job, nowMs)
        if (job.status == "in_progress" && eta != null) {
            // A paused job's ETA slides, so this gets re-armed on every change — which is
            // exactly what the realtime subscription gives us.
            set(job.id, JobAlert.LATE, eta, nowMs)
        } else {
            cancel(job.id, JobAlert.LATE)
        }
    }

    fun cancel(jobId: String) = JobAlert.entries.forEach { cancel(jobId, it) }

    fun cancel(jobId: String, alert: JobAlert) {
        am?.cancel(pending(jobId, alert, mutable = false))
    }

    private fun set(jobId: String, alert: JobAlert, atMs: Long, nowMs: Long) {
        val mgr = am ?: return
        // A moment already gone is not an alert; it is noise. (A job booked for last
        // Tuesday must not scream the instant the app opens.)
        if (atMs <= nowMs) return

        val pi = pending(jobId, alert, mutable = false)
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || mgr.canScheduleExactAlarms()
        runCatching {
            if (exact) {
                mgr.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi)
            } else {
                // Permission refused: still alert, just without promising the minute —
                // silently dropping the alarm would be the worse failure.
                mgr.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi)
            }
        }
    }

    private fun pending(jobId: String, alert: JobAlert, mutable: Boolean): PendingIntent {
        val i = Intent(context, JobAlarmReceiver::class.java).apply {
            action = "${ACTION_PREFIX}.${alert.id}"
            putExtra(EXTRA_JOB_ID, jobId)
            putExtra(EXTRA_ALERT, alert.id)
        }
        val flags = (if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE) or
            PendingIntent.FLAG_UPDATE_CURRENT
        return PendingIntent.getBroadcast(context, requestCode(jobId, alert), i, flags)
    }

    /** Stable per job+kind — the identity that makes re-arming a replace, not a duplicate. */
    private fun requestCode(jobId: String, alert: JobAlert): Int = (jobId + alert.id).hashCode()

    companion object {
        const val ACTION_PREFIX = "mu.carfection.pos.JOB_ALERT"
    }
}
