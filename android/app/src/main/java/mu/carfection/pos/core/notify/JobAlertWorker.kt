package mu.carfection.pos.core.notify

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import mu.carfection.pos.core.jobs.JobClock
import mu.carfection.pos.core.network.JobBoardDto
import mu.carfection.pos.core.network.PosApi

/**
 * The alarm is a TRIGGER; the server is the TRUTH. A "due to start" armed at 14:30 says
 * nothing about whether someone already started the car at 14:25, and a board that cries
 * wolf is a board staff learn to ignore. So we re-read the job here and stay quiet unless
 * the condition still holds.
 *
 * This runs as a worker rather than in JobAlarmReceiver because a foreground broadcast has
 * ~10s before Android calls it an ANR — and building the Supabase client (Auth, Postgrest,
 * Storage, Realtime) plus a round trip is no way to spend it.
 *
 * Expedited, because these alerts are supposed to land on the minute. The alarm is armed
 * with setExactAndAllowWhileIdle, which lifts Doze briefly when it fires, so work enqueued
 * in that window starts immediately rather than waiting for a maintenance window.
 */
@HiltWorker
class JobAlertWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val api: PosApi,
    private val notifications: JobNotifications,
    private val alarms: JobAlarms,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val jobId = inputData.getString(EXTRA_JOB_ID) ?: return Result.failure()
        val alert = JobAlert.entries.firstOrNull { it.id == inputData.getString(EXTRA_ALERT) }
            ?: return Result.failure()

        // Offline, or the job is gone. Give up rather than retry: a "booked in now" posted
        // several minutes late is noise, and JobWatcher re-arms everything the next time
        // the app is opened. This is what the receiver did before the fetch moved here.
        val job = runCatching { api.fetchJobForAlert(jobId) }.getOrNull() ?: return Result.success()

        if (stillTrue(job, alert)) {
            notifications.post(job, alert)
        } else {
            // The job moved while we waited — most often a pause, which slides the
            // ETA past this alarm. Re-arm from what is true now, so a paused job is
            // still chased when it really does run late. Without this the alert is
            // lost the first time anyone takes a tea break.
            alarms.arm(job)
        }
        return Result.success()
    }

    /**
     * API 26–30 has no expedited job, so WorkManager runs expedited work as a short
     * foreground service and asks for this. CoroutineWorker's default implementation
     * THROWS, which would turn every alert on an older tablet into a crash rather than a
     * notification. API 31+ never calls it.
     */
    override suspend fun getForegroundInfo(): ForegroundInfo =
        ForegroundInfo(CHECK_NOTIFICATION_ID, notifications.checkingNotice())

    companion object {
        /** Fixed id: only one of these is ever on screen, and only for a second. */
        private const val CHECK_NOTIFICATION_ID = 918_273

        fun request(jobId: String, alert: JobAlert): OneTimeWorkRequest =
            OneTimeWorkRequestBuilder<JobAlertWorker>()
                .setInputData(workDataOf(EXTRA_JOB_ID to jobId, EXTRA_ALERT to alert.id))
                // Out of quota, run it as ordinary work: a late alert beats no alert.
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
        // Deliberately NOT network-constrained. A constraint would hold a "due now" alert
        // until the tablet is back online, turning an honest give-up into silence.
    }
}

/**
 * Does the world still look the way it did when this alarm was armed?
 *
 * Top-level and internal so it can be tested without a Context or WorkerParameters; nowMs
 * is injectable for the same reason, following JobAlarms.arm(job, nowMs).
 */
internal fun stillTrue(
    job: JobBoardDto,
    alert: JobAlert,
    nowMs: Long = System.currentTimeMillis(),
): Boolean {
    // Finished is finished — nothing about a delivered car needs chasing.
    if (job.readyAt != null || job.deliveredAt != null || job.status == "cancelled") return false

    return when (alert) {
        // The booked moment has arrived. The server auto-starts the job at this
        // instant, so by now it may already be in_progress — fire either way, as
        // long as the car isn't finished (handled above). Gating this on
        // status == "scheduled" would swallow the notification exactly when the
        // flip won the race, which is most of the time.
        //
        // The one exception: a job a human STARTED EARLY (started_at before its
        // booked time) is already visibly underway, so "booked in now" would be a
        // stale ping. Auto-start stamps started_at == scheduled_at, and a normal
        // or late manual start is at/after it — all of those still fire.
        JobAlert.DUE -> {
            val started = JobClock.epoch(job.startedAt)
            val sched = JobClock.epoch(job.scheduledAt)
            started == null || sched == null || started >= sched
        }
        // Genuinely still not started — the server-down safety net.
        JobAlert.OVERDUE -> job.status == "scheduled"
        // Still running, and genuinely past its estimate. A pause slides the ETA, so a
        // job paused since the alarm was armed is not late yet — re-check, don't assume.
        JobAlert.LATE -> job.status == "in_progress" &&
            (JobClock.estimatedFinishMs(job, nowMs)?.let { nowMs >= it } ?: false)
        // Never armed as an alarm — it is an event, not a time.
        JobAlert.READY -> false
    }
}
