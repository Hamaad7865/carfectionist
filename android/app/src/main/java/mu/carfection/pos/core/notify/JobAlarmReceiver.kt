package mu.carfection.pos.core.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import mu.carfection.pos.core.jobs.JobClock
import mu.carfection.pos.core.network.JobBoardDto
import mu.carfection.pos.core.network.PosApi
import javax.inject.Inject

/**
 * An alarm has come home. It carries only a job id and a kind — deliberately.
 *
 * The alarm is a TRIGGER; the server is the TRUTH. A "due to start" armed at 14:30 says
 * nothing about whether someone already started the car at 14:25, and a board that cries
 * wolf is a board staff learn to ignore. So we re-read the job here and stay quiet unless
 * the condition still holds.
 */
@AndroidEntryPoint
class JobAlarmReceiver : BroadcastReceiver() {

    @Inject lateinit var api: PosApi
    @Inject lateinit var notifications: JobNotifications
    @Inject lateinit var alarms: JobAlarms

    override fun onReceive(context: Context, intent: Intent) {
        val jobId = intent.getStringExtra(EXTRA_JOB_ID) ?: return
        val alert = JobAlert.entries.firstOrNull { it.id == intent.getStringExtra(EXTRA_ALERT) } ?: return
        if (!notifications.canPost()) return

        // A receiver's process can be killed the moment onReceive returns; hold it open
        // for the round-trip, and give up rather than hang if the shop's line is down.
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val job = withTimeoutOrNull(TIMEOUT_MS) {
                    runCatching { api.fetchJobForAlert(jobId) }.getOrNull()
                }
                if (job == null) return@launch
                if (stillTrue(job, alert)) {
                    notifications.post(job, alert)
                } else {
                    // The job moved while we waited — most often a pause, which slides the
                    // ETA past this alarm. Re-arm from what is true now, so a paused job is
                    // still chased when it really does run late. Without this the alert is
                    // lost the first time anyone takes a tea break.
                    alarms.arm(job)
                }
            } finally {
                pending.finish()
            }
        }
    }

    /** Does the world still look the way it did when this alarm was armed? */
    private fun stillTrue(job: JobBoardDto, alert: JobAlert): Boolean {
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
                (JobClock.estimatedFinishMs(job, System.currentTimeMillis())
                    ?.let { System.currentTimeMillis() >= it } ?: false)
            // Never armed as an alarm — it is an event, not a time.
            JobAlert.READY -> false
        }
    }

    private companion object {
        const val TIMEOUT_MS = 10_000L
    }
}
