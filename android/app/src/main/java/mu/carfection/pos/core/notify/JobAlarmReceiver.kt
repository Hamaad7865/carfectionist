package mu.carfection.pos.core.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.WorkManager

/**
 * An alarm has come home. It carries only a job id and a kind — deliberately.
 *
 * Nothing is decided here. A foreground broadcast has ~10s before Android calls it an ANR,
 * and the decision needs a round trip to the server (see JobAlertWorker for why it cannot
 * be skipped). So this hands the id and the kind to a worker and returns immediately —
 * which also means the process may be killed the moment it does, without losing the alert.
 */
class JobAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val jobId = intent.getStringExtra(EXTRA_JOB_ID) ?: return
        val alert = JobAlert.entries.firstOrNull { it.id == intent.getStringExtra(EXTRA_ALERT) } ?: return
        // A cheap permission read, kept here rather than in the worker: no point scheduling
        // work that could only end in a notification nobody is allowed to see. It also
        // skips the re-arm in that case, exactly as this receiver did before.
        if (!JobNotifications.canPost(context)) return

        WorkManager.getInstance(context).enqueue(JobAlertWorker.request(jobId, alert))
    }
}
